import {
  App,
  type SearchResult,
  SuggestModal,
  getIconIds,
  prepareFuzzySearch,
  setIcon,
} from "obsidian";
import { Button } from "../ui/Button";

interface IconMatch {
  id: string;
  /** The id without its `lucide-` prefix, which is what reads as a name. */
  label: string;
  result: SearchResult;
}

const EMPTY_MATCH: SearchResult = { score: 0, matches: [] };

/**
 * Picks any icon Obsidian has registered — around two thousand of them, plus
 * whatever other plugins have added. The list comes from getIconIds() rather
 * than a hardcoded set, so it tracks whatever the running version ships.
 */
export class IconPickerModal extends SuggestModal<IconMatch> {
  /** Built once per open: the registry does not change while the modal is up. */
  private readonly icons: { id: string; label: string }[];

  constructor(
    app: App,
    private current: string,
    private onChoose: (icon: string) => void,
  ) {
    super(app);
    this.setPlaceholder("Search icons…");
    this.limit = 60;

    // Obsidian registers many icons twice, bare and `lucide-` prefixed. The
    // prefixed one is dropped so the list does not read as duplicates.
    const seen = new Set<string>();
    this.icons = [];
    for (const id of getIconIds()) {
      const label = id.replace(/^lucide-/, "");
      if (seen.has(label)) continue;
      seen.add(label);
      this.icons.push({ id, label });
    }
    this.icons.sort((a, b) => a.label.localeCompare(b.label));
  }

  getSuggestions(query: string): IconMatch[] {
    const trimmed = query.trim();
    if (!trimmed) {
      // The current icon leads, so the modal opens on what is already set.
      const rest = this.icons.filter((icon) => icon.id !== this.current);
      const chosen = this.icons.filter((icon) => icon.id === this.current);
      return [...chosen, ...rest].map((icon) => ({
        ...icon,
        result: EMPTY_MATCH,
      }));
    }

    const match = prepareFuzzySearch(trimmed);
    const found: IconMatch[] = [];
    for (const icon of this.icons) {
      const result = match(icon.label);
      if (result) found.push({ ...icon, result });
    }
    found.sort((a, b) => b.result.score - a.result.score);
    return found;
  }

  renderSuggestion(item: IconMatch, el: HTMLElement): void {
    el.addClass("mod-complex", "pt-icon-option");
    setIcon(el.createDiv({ cls: "pt-icon-option-preview" }), item.id);
    el.createDiv({ cls: "suggestion-content" }).createDiv({
      cls: "suggestion-title",
      text: item.label,
    });
    if (item.id === this.current) {
      el.createDiv({ cls: "suggestion-aux" }).createSpan({
        cls: "suggestion-flair",
        text: "Current",
      });
    }
  }

  onChooseSuggestion(item: IconMatch): void {
    this.onChoose(item.id);
  }
}

/**
 * A button that both shows the current icon and opens the picker. Doubling as
 * the preview means the choice is visible before anything is saved.
 */
export function renderIconButton(
  app: App,
  parent: HTMLElement,
  current: string,
  onChange: (icon: string) => void,
): void {
  let icon = current;
  const button = new Button(parent, {
    icon,
    tooltip: "Change icon",
    onClick: () => {
      new IconPickerModal(app, icon, (next) => {
        icon = next;
        button.setIcon(next);
        onChange(next);
      }).open();
    },
  });
}
