import {
  AbstractInputSuggest,
  App,
  type HeadingCache,
  type SearchResult,
  type TFile,
  prepareFuzzySearch,
  renderResults,
  setIcon,
} from "obsidian";
import type { CustomField, CustomFieldType } from "../types";
import { readFrontmatter } from "../io/frontmatter";
import { asText } from "../util/customFields";

interface Suggestion {
  /** What replaces the token in the field. */
  insert: string;
  /** The row's first line, fuzzy-highlighted against the query. */
  display: string;
  /** The row's second line: where the thing lives. Blank for no second line. */
  note: string;
  result: SearchResult;
}

interface Token {
  start: number;
  query: string;
  kind: "file" | "heading";
  /** For a heading token, the file part typed ahead of the `#`. */
  path: string;
}

/** Lets one set of controls drive a task's frontmatter or a config default. */
export interface ValueBinding {
  get(): unknown;
  set(value: unknown): void;
}

const EMPTY_MATCH: SearchResult = { score: 0, matches: [] };
const WIKILINK = /^\[\[([^\]]+)\]\]$/;

/**
 * Obsidian's own name for each type, used for `data-property-type`. Its CSS
 * keys off these values, so "list" has to go out as "multitext".
 */
const NATIVE_TYPE: Record<CustomFieldType, string> = {
  text: "text",
  list: "multitext",
  number: "number",
  checkbox: "checkbox",
  date: "date",
  datetime: "datetime",
};

/** Matches the icons Obsidian shows against each property type. */
const TYPE_ICON: Record<CustomFieldType, string> = {
  text: "align-left",
  list: "list",
  number: "binary",
  checkbox: "check-square",
  date: "calendar",
  datetime: "clock",
};

/**
 * Inline autocomplete for `[[links]]` and `[[note#headings]]`. A bare `#` is
 * left alone: it is not special in a property value, only inside a link.
 *
 * Obsidian's link suggester is an EditorSuggest, so it only runs against a real
 * editor and cannot be borrowed for a modal. This drives a contenteditable the
 * same way its own fields do — which is why AbstractInputSuggest accepts a div
 * as well as an input — and renders rows in Obsidian's own suggestion markup so
 * the popover matches the one `[[` opens in a note. It completes the token under
 * the caret rather than the whole value, so prose and links can mix.
 */
export class LinkSuggest extends AbstractInputSuggest<Suggestion> {
  constructor(
    app: App,
    private field: HTMLDivElement,
    private onCommit: () => void,
  ) {
    super(app, field);
    this.limit = 20;
  }

  private caret(): number {
    return caretOffset(this.field);
  }

  private token(): Token | null {
    const text = this.field.textContent ?? "";
    const before = text.slice(0, this.caret());

    // An unclosed "[[" before the caret means we are inside a link. A link
    // cannot span lines, which stops a stray "[[" swallowing the rest.
    const link = before.lastIndexOf("[[");
    const inner = link === -1 ? "" : before.slice(link + 2);
    if (link !== -1 && !inner.includes("]]") && !inner.includes("\n")) {
      const split = inner.indexOf("#");
      if (split === -1)
        return { start: link, query: inner, kind: "file", path: "" };

      // Inside a link a "#" asks for one of the note's headings — but only
      // once the part before it names a note that exists. An abandoned
      // "[[" would otherwise capture every later "#" in the value, and the
      // reader would get headings from whatever happened to precede it.
      const path = inner.slice(0, split).trim();
      if (path && this.app.metadataCache.getFirstLinkpathDest(path, "")) {
        return {
          start: link,
          query: inner.slice(split + 1),
          kind: "heading",
          path,
        };
      }
    }

    return null;
  }

  protected getSuggestions(_query: string): Suggestion[] {
    const token = this.token();
    if (!token) return [];

    const match = prepareFuzzySearch(token.query);
    const keep = (text: string): SearchResult | null =>
      token.query ? match(text) : EMPTY_MATCH;
    const items: Suggestion[] = [];

    if (token.kind === "heading") {
      for (const heading of this.headings(token.path)) {
        const result = keep(heading.heading);
        if (!result) continue;
        items.push({
          insert: `[[${token.path}#${heading.heading}]]`,
          display: heading.heading,
          note: token.path,
          result,
        });
      }
    } else if (token.kind === "file") {
      for (const file of this.app.vault.getMarkdownFiles()) {
        const text = this.app.metadataCache.fileToLinktext(file, "", true);
        const folder = file.parent?.path ?? "";
        const note = folder && folder !== "/" ? `${folder}/` : "";

        const result = keep(text);
        if (result)
          items.push({ insert: `[[${text}]]`, display: text, note, result });

        // An alias is how the reader thinks of the note, so it is worth
        // finding by. Obsidian resolves [[alias]] on its own.
        for (const alias of this.aliases(file)) {
          const aliasResult = keep(alias);
          if (!aliasResult) continue;
          items.push({
            insert: `[[${alias}]]`,
            display: alias,
            note: `${note}${text}`,
            result: aliasResult,
          });
        }
      }
    }

    items.sort((a, b) => b.result.score - a.result.score);
    return items.slice(0, this.limit || items.length);
  }

  /** Headings of the note a link's file part resolves to, if it resolves. */
  private headings(path: string): HeadingCache[] {
    if (!path) return [];
    const file = this.app.metadataCache.getFirstLinkpathDest(path, "");
    if (!file) return [];
    return this.app.metadataCache.getFileCache(file)?.headings ?? [];
  }

  private aliases(file: TFile): string[] {
    const raw = readFrontmatter(this.app, file)?.aliases;
    if (typeof raw === "string") return raw.trim() ? [raw.trim()] : [];
    if (!Array.isArray(raw)) return [];
    return raw.map((alias) => asText(alias).trim()).filter(Boolean);
  }

  /** Obsidian's own two-line suggestion row: name above, location below. */
  renderSuggestion(item: Suggestion, el: HTMLElement): void {
    el.addClass("mod-complex");
    const content = el.createDiv({ cls: "suggestion-content" });
    renderResults(
      content.createDiv({ cls: "suggestion-title" }),
      item.display,
      item.result,
    );
    if (item.note)
      content.createDiv({ cls: "suggestion-note", text: item.note });
  }

  selectSuggestion(item: Suggestion): void {
    const token = this.token();
    if (!token) return;

    const text = this.field.textContent ?? "";
    let after = text.slice(this.caret());
    // The field closes a link as it is opened, so the "]]" already sitting
    // past the caret would otherwise be doubled by the one being inserted.
    if (item.insert.endsWith("]]") && after.startsWith("]]"))
      after = after.slice(2);

    this.field.setText(text.slice(0, token.start) + item.insert + after);
    placeCaret(this.field, token.start + item.insert.length);
    this.onCommit();
    this.close();
  }
}

/** How many characters of the field sit before the caret. */
function caretOffset(el: HTMLElement): number {
  const selection = activeWindow.getSelection();
  if (!selection?.focusNode || !el.contains(selection.focusNode)) {
    return el.textContent?.length ?? 0;
  }
  const range = selection.getRangeAt(0).cloneRange();
  range.selectNodeContents(el);
  range.setEnd(selection.focusNode, selection.focusOffset);
  return range.toString().length;
}

function placeCaretAtEnd(el: HTMLElement): void {
  placeCaret(el, el.textContent?.length ?? 0);
}

/** Puts the caret `offset` characters into the field. */
function placeCaret(el: HTMLElement, offset: number): void {
  const range = activeDocument.createRange();
  const node = el.firstChild;

  if (node && node.nodeType === Node.TEXT_NODE) {
    range.setStart(node, Math.min(offset, node.textContent?.length ?? 0));
    range.collapse(true);
  } else {
    range.selectNodeContents(el);
    range.collapse(false);
  }

  const selection = activeWindow.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/**
 * Closes a wikilink as it is opened, the way the editor does: typing the second
 * "[" leaves the caret sitting between "[[" and "]]". Beyond the typing being
 * less work, it bounds the link — a "#" typed inside is unambiguously asking
 * for a heading, and one typed outside can only be a tag.
 */
function autoCloseLinks(field: HTMLElement, onCommit: () => void): void {
  field.addEventListener("input", () => {
    const text = field.textContent ?? "";
    const caret = caretOffset(field);
    if (!text.slice(0, caret).endsWith("[[")) return;
    // Already closed, either by this or by the reader typing it themselves.
    if (text.slice(caret).startsWith("]]")) return;

    field.setText(`${text.slice(0, caret)}]]${text.slice(caret)}`);
    placeCaret(field, caret);
    onCommit();
  });
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

/** Obsidian renders a link inside a pill as a real internal link. */
function renderPillContent(el: HTMLElement, item: string): void {
  const link = WIKILINK.exec(item);
  if (!link) {
    el.setText(item);
    return;
  }
  const [target, alias] = link[1].split("|");
  el.createEl("a", {
    cls: "internal-link",
    text: alias ?? target,
    attr: { href: target, "data-href": target },
  });
}

/** Obsidian renders single-line text values as a contenteditable, not an input. */
function renderTextValue(
  app: App,
  parent: HTMLElement,
  binding: ValueBinding,
  placeholder: string,
): void {
  const editable = parent.createDiv({
    cls: "metadata-input-longtext mod-truncate",
    attr: {
      contenteditable: "true",
      tabindex: "0",
      "data-placeholder": placeholder,
    },
  });
  editable.setText(asText(binding.get()));

  const commit = (): void => binding.set(editable.textContent ?? "");
  editable.addEventListener("input", commit);
  editable.addEventListener("blur", commit);
  new LinkSuggest(app, editable, commit);
  autoCloseLinks(editable, commit);
}

/** Pills plus an inline entry box, the way Obsidian renders a List property. */
function renderListValue(
  app: App,
  parent: HTMLElement,
  binding: ValueBinding,
  placeholder: string,
): void {
  const container = parent.createDiv({ cls: "multi-select-container" });

  // Built once and never torn down. Rebuilding it inside the commit was what
  // destroyed the live caret and made the field impossible to type in.
  const entry = container.createDiv({
    cls: "multi-select-input",
    attr: {
      contenteditable: "true",
      tabindex: "0",
      "data-placeholder": placeholder,
    },
  });

  const drawPills = (): void => {
    for (const pill of Array.from(
      container.querySelectorAll(".multi-select-pill"),
    )) {
      pill.remove();
    }

    asList(binding.get()).forEach((item, index) => {
      const pill = container.createDiv({ cls: "multi-select-pill" });
      renderPillContent(
        pill.createDiv({ cls: "multi-select-pill-content" }),
        item,
      );

      const remove = pill.createDiv({
        cls: "multi-select-pill-remove-button",
        attr: { "aria-label": `Remove ${item}` },
      });
      setIcon(remove, "x");
      remove.addEventListener("mousedown", (event) => {
        // Ahead of the entry's blur, so removal is not raced by a commit.
        event.preventDefault();
        const next = asList(binding.get());
        next.splice(index, 1);
        binding.set(next);
        drawPills();
      });

      container.insertBefore(pill, entry);
    });
  };

  const commit = (): void => {
    const text = (entry.textContent ?? "").trim();
    // Cleared first: committing moves focus, and the blur that follows must
    // not read the same text and add it a second time.
    entry.setText("");
    if (!text) return;
    binding.set([...asList(binding.get()), text]);
    drawPills();
  };

  // Constructed before the keydown below so the popover sees Enter first and
  // can claim it for a suggestion.
  new LinkSuggest(app, entry, () => undefined);
  autoCloseLinks(entry, () => undefined);

  entry.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      if (event.isComposing || event.defaultPrevented) return;
      event.preventDefault();
      commit();
      return;
    }

    // Backspace in an empty box pulls the last pill back for editing.
    if (event.key === "Backspace" && !(entry.textContent ?? "").length) {
      const next = asList(binding.get());
      const last = next.pop();
      if (last === undefined) return;
      event.preventDefault();
      binding.set(next);
      drawPills();
      entry.setText(last);
      placeCaretAtEnd(entry);
    }
  });
  entry.addEventListener("blur", commit);

  // The container shows a text cursor, so clicking its empty space should type.
  container.addEventListener("mousedown", (event) => {
    if (event.target !== container) return;
    event.preventDefault();
    entry.focus();
    placeCaretAtEnd(entry);
  });

  drawPills();
}

function renderScalarValue(
  parent: HTMLElement,
  type: CustomFieldType,
  binding: ValueBinding,
  placeholder: string,
): void {
  if (type === "checkbox") {
    const box = parent.createEl("input", {
      cls: "metadata-input-checkbox",
      attr: { type: "checkbox" },
    });
    box.checked = binding.get() === true;
    box.addEventListener("change", () => binding.set(box.checked));
    return;
  }

  const input = parent.createEl("input", {
    cls: `metadata-input metadata-input-${type === "number" ? "number" : "text"}`,
    attr: {
      type:
        type === "number"
          ? "number"
          : type === "date"
            ? "date"
            : "datetime-local",
      // Date inputs show their own format hint and ignore this.
      placeholder,
    },
  });
  input.value = asText(binding.get());
  input.addEventListener("input", () => binding.set(input.value));
}

/**
 * One editor for one value, dispatched on the field's type. Shared by the task
 * modals and by the default-value box in project config, so a default is
 * entered through exactly the control the value will later be edited with.
 */
/**
 * The container Obsidian puts every property value in, with the hover and focus
 * backgrounds that make a bare contenteditable read as a field.
 *
 * Task modals only. Project Config's Default Value rows are a form field in a
 * config form, not a property on a note, and deliberately look nothing like
 * this — see .pt-config-default-value.
 */
function valueContainer(
  parent: HTMLElement,
  type: CustomFieldType,
): HTMLElement {
  return parent.createDiv({
    cls: "metadata-property-value",
    attr: { "data-property-type": NATIVE_TYPE[type] },
  });
}

export function renderValueControl(
  app: App,
  parent: HTMLElement,
  type: CustomFieldType,
  binding: ValueBinding,
  placeholder = "",
): void {
  if (type === "list") renderListValue(app, parent, binding, placeholder);
  else if (type === "text") renderTextValue(app, parent, binding, placeholder);
  else renderScalarValue(parent, type, binding, placeholder);
}

/** The key half of a row: type icon plus the field's name. */
function renderKey(row: HTMLElement, field: CustomField): void {
  const key = row.createDiv({ cls: "metadata-property-key" });

  const icon = key.createSpan({
    cls: "metadata-property-icon",
    attr: {
      "aria-label": field.type,
      "data-property-type": NATIVE_TYPE[field.type],
    },
  });
  setIcon(icon, TYPE_ICON[field.type]);

  // An <input>, not a span: Obsidian ships no rule for this class, so the
  // padding and height that space it off the icon and put the two on one
  // baseline come from input styling. Read-only because the name is config.
  const name = key.createEl("input", {
    cls: "metadata-property-key-input",
    attr: { type: "text", readonly: "true", tabindex: "-1" },
  });
  name.value = field.name;
}

/**
 * Renders one row per configured field, reusing Obsidian's own property markup
 * and classes so the block inherits its native styling and the reader's theme.
 * Values are mutated in place, keyed by frontmatter key. The heading is the
 * caller's, since a modal may want the rows inside a settings group instead.
 */
export function renderCustomFields(
  app: App,
  parent: HTMLElement,
  fields: CustomField[],
  values: Record<string, unknown>,
): void {
  if (!fields.length) return;

  const content = parent
    .createDiv({ cls: "metadata-container pt-properties" })
    .createDiv({ cls: "metadata-content" });

  for (const field of fields) {
    const row = content.createDiv({
      cls: "metadata-property",
      attr: {
        "data-property-key": field.key,
        "data-property-type": NATIVE_TYPE[field.type],
      },
    });
    renderKey(row, field);

    renderValueControl(app, valueContainer(row, field.type), field.type, {
      get: () => values[field.key],
      set: (next) => {
        values[field.key] = next;
      },
    });
  }
}
