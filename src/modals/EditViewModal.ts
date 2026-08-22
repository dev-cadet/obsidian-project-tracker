import {
  DropdownComponent,
  Notice,
  SettingGroup,
  TextComponent,
  setIcon,
} from "obsidian";
import type { App } from "obsidian";
import type {
  DateField,
  DateOp,
  Project,
  SavedView,
  SortField,
  TableColumn,
} from "../types";
import { parseGroupBy, showDescriptionDefault } from "../types";
import { defaultColumns, emptyFilters } from "../util/defaults";
import { slugify } from "../util/slug";
import { Button } from "../ui/Button";
import { DragReorder } from "../ui/dragReorder";
import { PluginModal } from "../ui/PluginModal";
import { stacked } from "../ui/settingRow";

const DATE_FIELDS: Record<DateField, string> = {
  "task-created": "Created",
  "task-modified": "Modified",
  "task-start": "Start",
  "task-due": "Due",
  "task-status-modified": "Status changed",
};

const DATE_OPS: Record<DateOp, string> = {
  "within-last": "within the last",
  "older-than": "older than",
  before: "before",
  after: "after",
};

const SORT_FIELDS: Record<SortField, string> = {
  "task-name": "Title",
  "task-status": "Status",
  "task-labels": "Labels",
  "task-prioritized": "Priority",
  "task-created": "Created date",
  "task-modified": "Modified date",
  "task-start": "Start date",
  "task-due": "Due date",
};

const COLUMNS: Record<TableColumn, string> = {
  prioritized: "Prioritized",
  title: "Title",
  status: "Status",
  labels: "Labels",
  start: "Start",
  due: "Due",
  created: "Created",
  modified: "Modified",
};

function cloneView(view: SavedView): SavedView {
  return {
    ...view,
    filters: {
      ...view.filters,
      status: [...view.filters.status],
      labels: [...view.filters.labels],
      date: view.filters.date ? { ...view.filters.date } : null,
    },
    sort: { ...view.sort },
    columns: [...view.columns],
  };
}

export class EditViewModal extends PluginModal {
  private draft: SavedView;
  private readonly isNew: boolean;
  private bodyEl!: HTMLElement;

  constructor(
    app: App,
    private project: Project,
    existing: SavedView | null,
    private onSave: (view: SavedView) => void,
    private onDelete: (() => void) | null = null,
  ) {
    super(app, {
      header: existing === null ? "New View" : "Configure View",
      subHeader: project.title,
      accent: project.color,
    });
    this.isNew = existing === null;
    this.draft = existing
      ? cloneView(existing)
      : {
          id: `view-${Date.now().toString(36)}`,
          name: "",
          type: "table",
          filters: emptyFilters(),
          groupBy: "none",
          showDescription: showDescriptionDefault("table"),
          sort: { field: "task-created", dir: "desc" },
          columns: defaultColumns(),
        };
  }

  onOpen(): void {
    this.bodyEl = this.content.createDiv();

    // Outside the rebuilt region: switching layout redraws the body only.
    if (this.onDelete) {
      new Button(this.actionsLeft, {
        text: "Delete view",
        variant: "warning",
        onClick: () => {
          this.onDelete?.();
          this.close();
        },
      });
    }
    this.addCancelAction();
    this.setPrimaryAction({
      text: this.isNew ? "Create view" : "Save",
      onClick: () => this.submit(),
    });

    this.renderBody();
  }

  private renderBody(): void {
    // Rebuilt whenever the layout or a filter toggle changes shape, so hold
    // the reader's place rather than throwing them back to the top.
    const scrollTop = this.content.scrollTop;
    this.bodyEl.empty();

    const general = new SettingGroup(this.bodyEl)
      .setHeading("General")
      .addSetting((setting) => {
        stacked(setting)
          .setName("Name")
          .addText((text) =>
            text
              .setPlaceholder("Backlog")
              .setValue(this.draft.name)
              .onChange((value) => {
                this.draft.name = value;
              }),
          );
      })
      .addSetting((setting) => {
        setting.setName("Layout").addDropdown((dropdown) =>
          dropdown
            .addOptions({ table: "Table", kanban: "Board" })
            .setValue(this.draft.type)
            .onChange((value) => {
              this.draft.type = value === "kanban" ? "kanban" : "table";
              // A view being made has not been decided about yet, so it takes
              // the new layout's default. An existing one keeps what it was set
              // to, which is a choice someone made on purpose.
              if (this.isNew) {
                this.draft.showDescription = showDescriptionDefault(
                  this.draft.type,
                );
              }
              this.renderBody();
            }),
        );
      })
      // Applies to both layouts: a board orders the cards in each column by it,
      // and it is the table starting order before a header is clicked. This is
      // the only place a board can be sorted, so it does not belong under the
      // table-only settings below.
      .addSetting((setting) => {
        setting
          .setName("Sort by")
          .setDesc(
            "A table's column headers override this until the view is reopened.",
          )
          .addDropdown((dropdown) =>
            dropdown
              .addOptions({ none: "None", ...SORT_FIELDS })
              .setValue(this.draft.sort.field ?? "none")
              .onChange((value) => {
                this.draft.sort.field =
                  value === "none" ? null : (value as SortField);
              }),
          )
          .addDropdown((dropdown) =>
            dropdown
              .addOptions({ desc: "Descending", asc: "Ascending" })
              .setValue(this.draft.sort.dir)
              .onChange((value) => {
                this.draft.sort.dir = value === "asc" ? "asc" : "desc";
              }),
          );
      });

    // Both layouts, like Sort by above: a board puts it under the card title
    // and a table under the title in the same cell, so it is not a table
    // setting and does not belong under the table-only group below.
    general.addSetting((setting) => {
      setting
        .setName("Show description")
        .setDesc(
          this.draft.type === "kanban"
            ? "The first line of the task's description, under its name on the card."
            : "The first line of the task's description, under the task name in the same cell rather than as its own column.",
        )
        .addToggle((toggle) =>
          toggle.setValue(this.draft.showDescription).onChange((value) => {
            this.draft.showDescription = value;
          }),
        );
    });

    this.renderFilters(new SettingGroup(this.bodyEl).setHeading("Filters"));

    if (this.draft.type === "table") {
      new SettingGroup(this.bodyEl)
        .setHeading("Table Layout")
        .addSetting((setting) => {
          setting.setName("Group by").addDropdown((dropdown) =>
            dropdown
              .addOptions({ none: "Nothing", status: "Status", label: "Label" })
              .setValue(this.draft.groupBy)
              .onChange((value) => {
                this.draft.groupBy = parseGroupBy(value);
              }),
          );
        })
        .addSetting((setting) => {
          stacked(setting)
            .setName("Columns")
            .setDesc(
              "Ticked columns are shown, top to bottom as left to right. Drag to reorder.",
            );
          this.renderColumnList(setting.controlEl);
        });
    }

    this.content.scrollTop = scrollTop;
  }

  private renderFilters(filters: SettingGroup): void {
    let statusChips!: HTMLElement;
    filters.addSetting((setting) => {
      stacked(setting)
        .setName("Statuses")
        .setDesc(
          "Selected statuses are shown, and become the board's columns. Nothing selected means every status.",
        );
      statusChips = setting.controlEl;
    });

    for (const key of this.project.statusOrder) {
      const status = this.project.statuses[key];
      const chip = new Button(statusChips, {
        text: status.name,
        variant: this.draft.filters.status.includes(key) ? "cta" : "normal",
        onClick: () => {
          const index = this.draft.filters.status.indexOf(key);
          if (index === -1) this.draft.filters.status.push(key);
          else this.draft.filters.status.splice(index, 1);
          chip.setVariant(index === -1 ? "cta" : "normal");
        },
      });
    }

    const labelKeys = Object.keys(this.project.labels);
    if (labelKeys.length) {
      let labelChips!: HTMLElement;
      filters.addSetting((setting) => {
        stacked(setting)
          .setName("Labels")
          .setDesc("Matches tasks carrying any of these.");
        labelChips = setting.controlEl;
      });

      for (const key of labelKeys) {
        const label = this.project.labels[key];
        const chip = new Button(labelChips, {
          text: label.name,
          variant: this.draft.filters.labels.includes(key) ? "cta" : "normal",
          onClick: () => {
            const index = this.draft.filters.labels.indexOf(key);
            if (index === -1) this.draft.filters.labels.push(key);
            else this.draft.filters.labels.splice(index, 1);
            chip.setVariant(index === -1 ? "cta" : "normal");
          },
        });
      }
    }

    filters
      .addSetting((setting) => {
        setting.setName("Prioritized").addDropdown((dropdown) =>
          dropdown
            .addOptions({
              any: "Any",
              yes: "Prioritized only",
              no: "Not prioritized",
            })
            .setValue(
              this.draft.filters.prioritized === null
                ? "any"
                : this.draft.filters.prioritized
                  ? "yes"
                  : "no",
            )
            .onChange((value) => {
              this.draft.filters.prioritized =
                value === "any" ? null : value === "yes";
            }),
        );
      })
      .addSetting((setting) => {
        setting.setName("Date filter").addToggle((toggle) =>
          toggle
            .setValue(this.draft.filters.date !== null)
            .onChange((value) => {
              this.draft.filters.date = value
                ? { field: "task-created", op: "within-last", value: "30d" }
                : null;
              this.renderBody();
            }),
        );
      });

    const dateFilter = this.draft.filters.date;
    if (!dateFilter) return;

    // A block rather than another item: this is a continuation of the toggle
    // above, so it must not take a divider of its own.
    const row = filters.listEl.createDiv({
      cls: "pt-config-block pt-date-filter",
    });
    const relative =
      dateFilter.op === "within-last" || dateFilter.op === "older-than";
    if (relative) {
      row.createDiv({
        cls: "pt-modal-status",
        text: "Durations use h, d, w, m or y — for example 30d or 2w.",
      });
    }

    const controls = row.createDiv({ cls: "pt-date-filter-controls" });

    new DropdownComponent(controls)
      .addOptions(DATE_FIELDS)
      .setValue(dateFilter.field)
      .onChange((value) => {
        dateFilter.field = value as DateField;
      });

    new DropdownComponent(controls)
      .addOptions(DATE_OPS)
      .setValue(dateFilter.op)
      .onChange((value) => {
        const previous = dateFilter.op;
        dateFilter.op = value as DateOp;
        const wasRelative =
          previous === "within-last" || previous === "older-than";
        const isRelative =
          dateFilter.op === "within-last" || dateFilter.op === "older-than";
        if (wasRelative !== isRelative)
          dateFilter.value = isRelative ? "30d" : "";
        this.renderBody();
      });

    const value = new TextComponent(controls);
    if (!relative) value.inputEl.type = "date";
    value
      .setPlaceholder(relative ? "30d" : "")
      .setValue(dateFilter.value)
      .onChange((next) => {
        dateFilter.value = next;
      });
  }

  /**
   * Shown columns first, in the order the table will render them, then the
   * rest below a divider. Only the shown ones drag: there is no order to a
   * column that is not on the table.
   */
  private renderColumnList(parent: HTMLElement): void {
    const shown = this.draft.columns;
    const hidden = (Object.keys(COLUMNS) as TableColumn[]).filter(
      (key) => !shown.includes(key),
    );
    const list = parent.createDiv({ cls: "pt-column-list" });
    const reorder = new DragReorder((from, to) => {
      const [column] = this.draft.columns.splice(from, 1);
      this.draft.columns.splice(to, 0, column);
      this.renderBody();
    });

    // Indices are into draft.columns, which is exactly the shown list.
    shown.forEach((key, index) => {
      const row = this.renderColumnRow(list, key, true);
      // The whole row drags: it holds a checkbox and a label, neither of which
      // needs text selection.
      reorder.attach(row, row, index);
    });

    if (!shown.length) {
      list.createDiv({ cls: "pt-modal-status", text: "No columns shown." });
    }

    // No divider: an unticked checkbox and no drag grip say it clearly enough.
    for (const key of hidden) this.renderColumnRow(list, key, false);
  }

  private renderColumnRow(
    list: HTMLElement,
    key: TableColumn,
    shown: boolean,
  ): HTMLElement {
    const row = list.createDiv({ cls: "pt-column-row" });
    row.toggleClass("is-shown", shown);

    const grip = row.createSpan({ cls: "pt-column-grip" });
    if (shown) setIcon(grip, "grip-vertical");

    const check = row.createEl("input", {
      attr: { type: "checkbox", "aria-label": COLUMNS[key] },
    });
    check.checked = shown;
    check.addEventListener("change", () => {
      // A column being shown joins the right-hand end, where a newly ticked
      // one is least likely to disturb an order already settled on.
      if (check.checked) this.draft.columns.push(key);
      else this.draft.columns.splice(this.draft.columns.indexOf(key), 1);
      this.renderBody();
    });

    row.createSpan({ text: COLUMNS[key] });
    return row;
  }

  private submit(): void {
    const name = this.draft.name.trim();
    if (!name) {
      new Notice("Give the view a name.");
      return;
    }
    if (this.draft.type === "table" && !this.draft.columns.length) {
      new Notice("Pick at least one column.");
      return;
    }
    this.draft.name = name;
    if (this.isNew)
      this.draft.id = `${slugify(name)}-${this.draft.id.split("-").pop()}`;
    this.onSave(this.draft);
    this.close();
  }
}
