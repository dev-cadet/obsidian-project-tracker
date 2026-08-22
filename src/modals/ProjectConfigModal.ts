import { App, MarkdownView, Notice, Platform, SettingGroup, setIcon } from "obsidian";
import type ProjectTrackerPlugin from "../main";
import type {
  BoardConfig,
  CustomField,
  CustomFieldType,
  LabelOption,
  Project,
  SavedView,
  StatusOption,
} from "../types";
import { RESERVED_TASK_KEYS } from "../types";
import { editFrontmatter } from "../io/frontmatter";
import { writeProjectConfig, writeProjectProperties } from "../io/projectFile";
import { parseDuration } from "../util/dates";
import { slugify } from "../util/slug";
import { Button } from "../ui/Button";
import { DragReorder } from "../ui/dragReorder";
import { PluginModal } from "../ui/PluginModal";
import { stacked } from "../ui/settingRow";
import { renderColorDot } from "./colorPicker";
import { renderIconButton } from "./IconPickerModal";
import { renderValueControl } from "./propertyField";
import { normalizeCustomValue } from "../util/customFields";

const FALLBACK_COLOR = "#6e7781";

/**
 * A key follows its name, so renaming "Completed" retargets everything that
 * referred to `complete`. `originalKey` is what is on disk, and the difference
 * between the two is the migration to run on save.
 */
interface KeyedDraft {
  /** null for a row added in this session: nothing on disk refers to it yet. */
  originalKey: string | null;
  key: string;
  name: string;
  color: string;
}

interface StatusDraft extends KeyedDraft {
  nextStatus: string | null;
  /** Kept as raw text so a half-typed duration is not silently discarded. */
  autoStatusChange: string;
  warnStart: boolean;
  warnDue: boolean;
}

type LabelDraft = KeyedDraft;

interface FieldDraft extends KeyedDraft {
  type: CustomFieldType;
  defaultValue: unknown;
}

const FIELD_TYPE_NAMES: Record<CustomFieldType, string> = {
  text: "Text",
  list: "List",
  number: "Number",
  checkbox: "Checkbox",
  date: "Date",
  datetime: "Date & time",
};

export class ProjectConfigModal extends PluginModal {
  private title: string;
  private description: string;
  private color: string;
  private icon: string;
  private defaultView: string;
  private openTasksInBoard: boolean;
  private statuses: StatusDraft[];
  private labels: LabelDraft[];
  private fields: FieldDraft[];
  private bodyEl!: HTMLElement;
  /** Key of a row just added, so the rebuild can put the caret in it. */
  private focusKey: string | null = null;
  private pendingFocus: HTMLInputElement | null = null;

  constructor(
    app: App,
    private plugin: ProjectTrackerPlugin,
    private project: Project,
  ) {
    super(app, {
      header: "Project Configuration",
      subHeader: project.title,
      accent: project.color,
    });
    this.title = project.title;
    this.description = project.description;
    this.color = project.color;
    this.icon = project.icon;
    this.defaultView = project.board.defaultView;
    this.openTasksInBoard = project.board.openTasksInBoard;

    this.statuses = project.statusOrder.map((key) => ({
      originalKey: key,
      key,
      name: project.statuses[key]?.name ?? key,
      color: project.statuses[key]?.color ?? FALLBACK_COLOR,
      nextStatus: project.statuses[key]?.nextStatus ?? null,
      autoStatusChange: project.statuses[key]?.autoStatusChange ?? "",
      warnStart: project.statuses[key]?.warnStart ?? false,
      warnDue: project.statuses[key]?.warnDue ?? false,
    }));

    this.labels = Object.entries(project.labels).map(([key, label]) => ({
      originalKey: key,
      key,
      name: label.name,
      color: label.color,
    }));

    this.fields = project.customFields.map((field) => ({
      originalKey: field.key,
      key: field.key,
      name: field.name,
      color: FALLBACK_COLOR,
      type: field.type,
      defaultValue: normalizeCustomValue(field.type, field.defaultValue),
    }));
  }

  onOpen(): void {
    this.bodyEl = this.content.createDiv();

    // Outside the rebuilt region: nothing in it depends on the draft.
    new Button(this.actionsRight, {
      text: "View file",
      icon: "file-text",
      onClick: () => void this.openConfigFile(),
    });
    this.setPrimaryAction({
      text: "Save",
      onClick: () => void this.submit(),
    });

    this.renderBody();
  }

  private renderBody(): void {
    // Rebuilding the whole form otherwise throws the reader back to the top
    // every time a row is added, removed or moved.
    const scroller = this.content;
    const scrollTop = scroller.scrollTop;

    this.bodyEl.empty();
    const el = this.bodyEl;

    new SettingGroup(el)
      .setHeading("General")
      .addSetting((setting) => {
        stacked(setting)
          .setName("Title")
          .addText((text) =>
            text.setValue(this.title).onChange((value) => {
              this.title = value;
              // The header names the project being configured, so a stale name
              // directly above the field editing it reads as a bug.
              this.setSubHeader(value);
            }),
          );
        renderIconButton(this.app, setting.controlEl, this.icon, (icon) => {
          this.icon = icon;
        });
      })
      .addSetting((setting) => {
        setting
          .setName("Project colour")
          .setDesc("Used for the project's icon and card accent.");
        renderColorDot(setting.controlEl, this.color, (value) => {
          this.color = value;
        });
      })
      .addSetting((setting) => {
        stacked(setting)
          .setName("Description")
          .addTextArea((text) =>
            text.setValue(this.description).onChange((value) => {
              this.description = value;
            }),
          );
      });

    this.renderBoardSection(el);
    this.renderStatusSection(el);
    this.renderLabelSection(el);
    this.renderFieldSection(el);

    scroller.scrollTop = scrollTop;
    this.applyPendingFocus();
  }

  /**
   * Bring a newly added row into view, and on a desktop put the cursor in it.
   *
   * The scroll happens after the restore above, so it wins if the row is
   * off-screen. The focus does not happen at all on a touch screen: adding a
   * row there would raise the keyboard over the list the row was just added to,
   * and scrolling to it is the half of this that was doing the useful work.
   */
  private applyPendingFocus(): void {
    const input = this.pendingFocus;
    if (!input) return;
    this.pendingFocus = null;
    this.focusKey = null;

    if (!Platform.isMobile) {
      input.focus();
      input.select();
    }
    input.scrollIntoView({ block: "nearest" });
  }

  private renderBoardSection(parent: HTMLElement): void {
    new SettingGroup(parent)
      .setHeading("Board Settings")
      .addSetting((setting) => {
        setting
          .setName("Default view")
          .setDesc("Opened first when the project is opened.")
          .addDropdown((dropdown) => {
            for (const view of this.project.board.views) {
              dropdown.addOption(view.id, view.name);
            }
            dropdown.setValue(this.defaultView).onChange((value) => {
              this.defaultView = value;
            });
          });
      })
      .addSetting((setting) => {
        setting
          .setName("Open tasks in board")
          .setDesc("Return to the board after creating a task from a command.")
          .addToggle((toggle) =>
            toggle.setValue(this.openTasksInBoard).onChange((value) => {
              this.openTasksInBoard = value;
            }),
          );
      });
  }

  private renderStatusSection(parent: HTMLElement): void {
    const el = new SettingGroup(parent)
      .addClass("pt-group-split")
      .setHeading(this.statusHeading())
      .listEl.createDiv({ cls: "pt-config-block" });
    el.createDiv({
      cls: "pt-modal-status",
      text: "Order sets the board's columns. Renaming a status rewrites its key on save, along with every task and view filter that refers to it.",
    });

    const list = el.createDiv({ cls: "pt-config-list" });
    const reorder = this.reorderer(this.statuses);
    this.statuses.forEach((status, index) =>
      this.renderStatusRow(list, status, index, reorder),
    );

    this.addButton(el, "Add status", () => {
      const key = this.uniqueKey("New status", this.takenKeys(this.statuses));
      this.focusKey = key;
      this.statuses.push({
        originalKey: null,
        key,
        name: "New status",
        color: FALLBACK_COLOR,
        nextStatus: null,
        autoStatusChange: "",
        warnStart: false,
        warnDue: false,
      });
      this.renderBody();
    });
  }

  /**
   * The Statuses heading, with the show/hide control on its right.
   *
   * `setHeading` takes a DocumentFragment as well as a string, which is what
   * lets the heading carry a control of its own: SettingGroup exposes only
   * `listEl`, so the alternative would be reaching into its header element.
   *
   * The state is the user's preference for the dialog rather than anything about
   * this project, so it is saved in the plugin's own data — opening a different
   * project finds it where it was left, and no config note gains a key for it.
   */
  private statusHeading(): DocumentFragment {
    const advanced = this.plugin.settings.showAdvancedStatuses;

    return createFragment((frag) => {
      frag.createSpan({ text: "Statuses" });

      // Text rather than a button: it reveals more of the section it names, and
      // a button in a heading row reads as an action on the section itself.
      const toggle = frag.createSpan({
        cls: "pt-group-advanced",
        text: advanced ? "Hide Advanced" : "Show Advanced",
        attr: { role: "button", tabindex: "0" },
      });

      const flip = (): void => {
        this.plugin.settings.showAdvancedStatuses = !advanced;
        void this.plugin.saveSettings();
        this.renderBody();
      };
      toggle.addEventListener("click", flip);
      toggle.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        flip();
      });
    });
  }

  private renderStatusRow(
    list: HTMLElement,
    status: StatusDraft,
    index: number,
    reorder: DragReorder,
  ): void {
    const row = list.createDiv({ cls: "pt-config-row" });

    const main = row.createDiv({ cls: "pt-config-row-main" });
    reorder.attach(row, this.renderGrip(main), index);
    renderColorDot(main, status.color, (value) => {
      status.color = value;
    });

    this.renderNameField(main, status, this.statuses, "Status name");
    this.renderRowActions(
      main,
      index,
      this.statuses,
      () => this.statuses.length > 1,
    );

    // Everything below is advanced: a project can be set up without touching
    // any of it, and the four rows together are most of the dialog's height.
    if (!this.plugin.settings.showAdvancedStatuses) return;

    const meta = row.createDiv({ cls: "pt-config-row-meta" });

    const nextField = meta.createDiv({ cls: "pt-config-field" });
    nextField.createSpan({ cls: "pt-config-field-label", text: "Next status" });
    const next = nextField.createEl("select", { cls: "pt-input-style-flat" });
    next.createEl("option", { value: "", text: "None" });
    for (const other of this.statuses) {
      if (other === status) continue;
      next.createEl("option", {
        value: other.key,
        text: other.name || other.key,
      });
    }
    next.value = status.nextStatus ?? "";
    next.addEventListener("change", () => {
      status.nextStatus = next.value || null;
    });

    const autoField = meta.createDiv({ cls: "pt-config-field" });
    autoField.createSpan({
      cls: "pt-config-field-label",
      text: "Auto-advance after",
    });
    const auto = autoField.createEl("input", {
      cls: "pt-config-duration",
      attr: { type: "text", placeholder: "30d" },
    });
    auto.value = status.autoStatusChange;
    auto.addEventListener("input", () => {
      status.autoStatusChange = auto.value;
    });

    this.renderCheckField(meta, "Warn start date", status.warnStart, (value) => {
      status.warnStart = value;
    });
    this.renderCheckField(meta, "Warn due date", status.warnDue, (value) => {
      status.warnDue = value;
    });
  }

  /**
   * A boolean on a config row.
   *
   * `metadata-input-checkbox` is Obsidian's own, the box its properties panel
   * draws for a checkbox property — the same one this dialog already uses for a
   * custom field of that type.
   */
  private renderCheckField(
    parent: HTMLElement,
    label: string,
    value: boolean,
    onChange: (value: boolean) => void,
  ): void {
    const field = parent.createDiv({ cls: "pt-config-field" });
    field.createSpan({ cls: "pt-config-field-label", text: label });
    const box = field.createEl("input", {
      cls: "metadata-input-checkbox",
      attr: { type: "checkbox" },
    });
    box.checked = value;
    box.addEventListener("change", () => onChange(box.checked));
  }

  private renderLabelSection(parent: HTMLElement): void {
    const el = new SettingGroup(parent)
      .setHeading("Labels")
      .listEl.createDiv({ cls: "pt-config-block" });

    const list = el.createDiv({ cls: "pt-config-list" });
    const reorder = this.reorderer(this.labels);

    for (const [index, label] of this.labels.entries()) {
      const row = list.createDiv({ cls: "pt-config-row" });
      const main = row.createDiv({ cls: "pt-config-row-main" });

      reorder.attach(row, this.renderGrip(main), index);
      renderColorDot(main, label.color, (value) => {
        label.color = value;
      });

      this.renderNameField(main, label, this.labels, "Label name");
      this.renderRowActions(main, index, this.labels, () => true);
    }

    if (!this.labels.length) {
      list.createDiv({ cls: "pt-modal-status", text: "No labels yet." });
    }

    this.addButton(el, "Add label", () => {
      const key = this.uniqueKey("New label", this.takenKeys(this.labels));
      this.focusKey = key;
      this.labels.push({
        originalKey: null,
        key,
        name: "New label",
        color: FALLBACK_COLOR,
      });
      this.renderBody();
    });
  }

  private renderFieldSection(parent: HTMLElement): void {
    const el = new SettingGroup(parent)
      .setHeading("Custom Fields")
      .listEl.createDiv({ cls: "pt-config-block" });
    el.createDiv({
      cls: "pt-modal-status",
      text: "Stored in each task's frontmatter under the field's key. Obsidian owns property types vault-wide, so a new key may need its type set once from a note's Properties panel.",
    });

    const list = el.createDiv({ cls: "pt-config-list" });
    const reorder = this.reorderer(this.fields);

    for (const [index, field] of this.fields.entries()) {
      const row = list.createDiv({ cls: "pt-config-row" });
      const main = row.createDiv({ cls: "pt-config-row-main" });

      reorder.attach(row, this.renderGrip(main), index);
      this.renderNameField(main, field, this.fields, "Field name");

      // Beside the name rather than on its own line: the type names are
      // short enough to label themselves, so the row stays one line high.
      const select = main.createEl("select", {
        cls: "pt-config-type pt-input-style-flat",
      });
      for (const [value, name] of Object.entries(FIELD_TYPE_NAMES)) {
        select.createEl("option", { value, text: name });
      }
      select.value = field.type;
      select.addEventListener("change", () => {
        field.type = select.value as CustomFieldType;
        // Carried across rather than dropped, so a mistaken type change
        // does not silently bin whatever default was already entered.
        field.defaultValue = normalizeCustomValue(
          field.type,
          field.defaultValue,
        );
        this.renderBody();
      });

      this.renderRowActions(main, index, this.fields, () => true);

      // The default is entered through the same control the value will
      // later be edited with, so the type is never in question.
      const meta = row.createDiv({ cls: "pt-config-row-meta" });
      const defaults = meta.createDiv({
        cls: "pt-config-field pt-config-default",
      });
      defaults.createSpan({
        cls: "pt-config-field-label",
        text: "Default Value",
      });

      // Same container the note's Properties panel uses, so every type sizes
      // and behaves the way it will once written to a task.
      // Deliberately not Obsidian's .metadata-property-value: how a value is
      // shown on a task and how its default is entered here are different
      // things, and share no styling.
      renderValueControl(
        this.app,
        defaults.createDiv({ cls: "pt-config-default-value" }),
        field.type,
        {
          get: () => field.defaultValue,
          set: (next) => {
            field.defaultValue = next;
          },
        },
      );
    }

    if (!this.fields.length) {
      list.createDiv({ cls: "pt-modal-status", text: "No custom fields yet." });
    }

    this.addButton(el, "Add field", () => {
      const key = this.uniqueKey("New field", this.takenKeys(this.fields));
      this.focusKey = key;
      this.fields.push({
        originalKey: null,
        key,
        name: "New field",
        color: FALLBACK_COLOR,
        type: "text",
        defaultValue: null,
      });
      this.renderBody();
    });
  }

  /**
   * Name input with its key shown inside the field's right edge, so the typing
   * area is the same width on every row. The key tracks what is typed, which
   * makes the rename visible before it is committed.
   */
  private renderNameField(
    parent: HTMLElement,
    draft: KeyedDraft,
    siblings: KeyedDraft[],
    placeholder: string,
  ): void {
    const field = parent.createDiv({ cls: "pt-config-input" });

    const input = field.createEl("input", {
      cls: "pt-config-name",
      attr: { type: "text", placeholder },
    });
    input.value = draft.name;
    if (this.focusKey !== null && draft.key === this.focusKey)
      this.pendingFocus = input;

    const badge = field.createEl("code", {
      cls: "pt-config-key",
      text: draft.key,
      attr: { title: draft.key },
    });

    input.addEventListener("input", () => {
      draft.name = input.value;
      draft.key = this.deriveKey(draft, siblings);
      badge.setText(draft.key);
      badge.setAttr("title", draft.key);
      badge.toggleClass(
        "is-renamed",
        draft.originalKey !== null && draft.originalKey !== draft.key,
      );
    });
  }

  /** One reorderer per rendered list; splices the array and redraws. */
  private reorderer<T>(items: T[]): DragReorder {
    return new DragReorder((from, to) => {
      const [item] = items.splice(from, 1);
      items.splice(to, 0, item);
      this.renderBody();
    });
  }

  /** The drag handle. Only the grip is draggable, so the name field beside it
   * can still be selected with the mouse. */
  private renderGrip(parent: HTMLElement): HTMLElement {
    const grip = parent.createSpan({
      cls: "pt-config-grip",
      attr: { "aria-label": "Drag to reorder" },
    });
    setIcon(grip, "grip-vertical");
    return grip;
  }

  /** Remove. Ordering is the grip's job on every one of these lists. */
  private renderRowActions<T>(
    parent: HTMLElement,
    index: number,
    items: T[],
    canDelete: () => boolean,
  ): void {
    const actions = parent.createDiv({
      cls: "pt-config-actions pt-btn-group",
    });

    new Button(actions, {
      icon: "trash",
      tooltip: "Remove",
      variant: "warning",
      disabled: !canDelete(),
      onClick: () => {
        items.splice(index, 1);
        this.renderBody();
      },
    });
  }

  private addButton(
    parent: HTMLElement,
    text: string,
    onClick: () => void,
  ): void {
    new Button(parent, { text, onClick });
  }

  private takenKeys(drafts: KeyedDraft[], except?: KeyedDraft): Set<string> {
    return new Set(drafts.filter((d) => d !== except).map((d) => d.key));
  }

  /** A blank name keeps the current key; save rejects the blank name anyway. */
  private deriveKey(draft: KeyedDraft, siblings: KeyedDraft[]): string {
    if (!draft.name.trim()) return draft.key;
    return this.uniqueKey(draft.name, this.takenKeys(siblings, draft));
  }

  private uniqueKey(base: string, taken: Set<string>): string {
    const slug = slugify(base);
    if (!taken.has(slug)) return slug;
    let counter = 2;
    while (taken.has(`${slug}-${counter}`)) counter++;
    return `${slug}-${counter}`;
  }

  /** old key -> new key, for the rows whose name changed the key. */
  private renames(drafts: KeyedDraft[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const draft of drafts) {
      if (draft.originalKey && draft.originalKey !== draft.key) {
        map.set(draft.originalKey, draft.key);
      }
    }
    return map;
  }

  /** Reuses the tab the config note is already in rather than opening another. */
  private async openConfigFile(): Promise<void> {
    const path = this.project.configFile.path;
    const open = this.app.workspace
      .getLeavesOfType("markdown")
      .find((leaf) => (leaf.view as MarkdownView).file?.path === path);

    this.close();
    if (open) {
      this.app.workspace.setActiveLeaf(open, { focus: true });
      await this.app.workspace.revealLeaf(open);
      return;
    }
    await this.app.workspace.getLeaf(false).openFile(this.project.configFile);
  }

  /** Returns a message, or null when the draft is safe to write. */
  private problem(): string | null {
    if (!this.title.trim()) return "The project needs a title.";
    if (!this.statuses.length) return "A project needs at least one status.";

    for (const status of this.statuses) {
      if (!status.name.trim()) return "Every status needs a name.";
      const duration = status.autoStatusChange.trim();
      if (duration && parseDuration(duration) === null) {
        return `"${duration}" is not a duration — use a number with h, d, w, m or y.`;
      }
    }

    for (const label of this.labels) {
      if (!label.name.trim()) return "Every label needs a name.";
    }

    for (const field of this.fields) {
      if (!field.name.trim()) return "Every custom field needs a name.";
      // The plugin already owns these frontmatter keys on a task note.
      if (RESERVED_TASK_KEYS.has(field.key)) {
        return `"${field.key}" is a key Project Tracker already uses — rename that field.`;
      }
    }
    return null;
  }

  private async submit(): Promise<void> {
    const problem = this.problem();
    if (problem) {
      new Notice(problem);
      return;
    }

    const statusRenames = this.renames(this.statuses);
    const labelRenames = this.renames(this.labels);
    const fieldRenames = this.renames(this.fields);
    const remap = (map: Map<string, string>, key: string): string =>
      map.get(key) ?? key;

    const keys = new Set(this.statuses.map((s) => s.key));
    const statuses: Record<string, StatusOption> = {};
    for (const draft of this.statuses) {
      // The dropdown stored whichever key was current when it rendered, so a
      // later rename of the target is resolved here rather than at pick time.
      const next = draft.nextStatus
        ? remap(statusRenames, draft.nextStatus)
        : null;
      statuses[draft.key] = {
        name: draft.name.trim(),
        color: draft.color,
        // A chain pointing at a removed status would strand tasks there.
        nextStatus: next && keys.has(next) ? next : null,
        autoStatusChange: draft.autoStatusChange.trim() || null,
        warnStart: draft.warnStart,
        warnDue: draft.warnDue,
      };
    }

    const labels: Record<string, LabelOption> = {};
    for (const draft of this.labels) {
      labels[draft.key] = { name: draft.name.trim(), color: draft.color };
    }

    const customFields: CustomField[] = this.fields.map((draft) => ({
      key: draft.key,
      name: draft.name.trim(),
      type: draft.type,
      defaultValue: normalizeCustomValue(draft.type, draft.defaultValue),
    }));

    const views: SavedView[] = this.project.board.views.map((view) => ({
      ...view,
      filters: {
        ...view.filters,
        status: view.filters.status.map((key) => remap(statusRenames, key)),
        labels: view.filters.labels.map((key) => remap(labelRenames, key)),
      },
    }));

    const board: BoardConfig = {
      defaultView: views.some((v) => v.id === this.defaultView)
        ? this.defaultView
        : (views[0]?.id ?? this.defaultView),
      openTasksInBoard: this.openTasksInBoard,
      views,
    };

    try {
      await writeProjectConfig(this.app, this.project, {
        title: this.title.trim(),
        description: this.description.trim(),
        statuses,
        labels,
        customFields,
        board,
      });
      await writeProjectProperties(this.app, this.project, {
        color: this.color,
        icon: this.icon,
      });
    } catch (error) {
      console.error(
        "Project Tracker: failed to save the project config",
        error,
      );
      new Notice(
        "Could not save the config — see the console for details.",
      );
      return;
    }

    const migrated = await this.migrateTasks(
      statusRenames,
      labelRenames,
      fieldRenames,
    );
    this.close();
    if (migrated.changed || migrated.failed) {
      new Notice(this.migrationSummary(migrated));
    }
  }

  /**
   * Retargets tasks still holding a renamed key. Runs after the config is
   * written, so a task that fails here points at a key the config still
   * defines under its new name rather than at nothing at all.
   */
  private async migrateTasks(
    statusRenames: Map<string, string>,
    labelRenames: Map<string, string>,
    fieldRenames: Map<string, string>,
  ): Promise<{ changed: number; failed: number }> {
    if (!statusRenames.size && !labelRenames.size && !fieldRenames.size) {
      return { changed: 0, failed: 0 };
    }

    let changed = 0;
    let failed = 0;

    for (const task of this.plugin.store.getTasks(this.project.id)) {
      const nextStatus = statusRenames.get(task.status);
      const nextLabels = task.labels.some((label) => labelRenames.has(label))
        ? task.labels.map((label) => labelRenames.get(label) ?? label)
        : null;
      const movedFields = [...fieldRenames].filter(
        ([from]) => from in task.custom,
      );
      if (!nextStatus && !nextLabels && !movedFields.length) continue;

      try {
        await editFrontmatter(this.app, task.file, (fm) => {
          // Only the key's spelling changed, so task-modified is left alone.
          if (nextStatus) fm["task-status"] = nextStatus;
          if (nextLabels) fm["task-labels"] = nextLabels;
          // Carry the value to the new key, then drop the old one.
          for (const [from, to] of movedFields) {
            fm[to] = fm[from];
            delete fm[from];
          }
        });
        changed++;
      } catch (error) {
        console.error(
          `Project Tracker: could not retarget ${task.file.path}`,
          error,
        );
        failed++;
      }
    }

    return { changed, failed };
  }

  private migrationSummary({
    changed,
    failed,
  }: {
    changed: number;
    failed: number;
  }): string {
    const tasks = `${changed} task${changed === 1 ? "" : "s"}`;
    if (!failed)
      return `Updated ${tasks} for the renamed keys.`;
    return `Updated ${tasks}, but ${failed} could not be written — see the console.`;
  }
}
