import { Platform, setIcon } from "obsidian";
import type { Project, SavedView, TableColumn, Task } from "../../../types";
import type { TaskHost } from "../TaskHost";
import { priorityFlag, taskField } from "../../shared/chips";
import { renderTaskCard } from "../../shared/TaskCard";
import { COLUMN_HEADERS as HEADERS, COLUMN_SORT as SORTABLE, normalizeColumns } from "../columnMeta";
import { buildGroups } from "../grouping";

function renderCell(
	row: HTMLElement,
	column: TableColumn,
	project: Project,
	task: Task,
	host: TaskHost,
	showDescription: boolean
): void {
	const cell = row.createEl("td", { cls: `pt-cell pt-cell-${column}` });

	// Two columns the table draws itself: a title is the link that opens the task,
	// and priority is a bare icon in a column sized for one. The rest are the same
	// chips a card shows, so they come from the one place that draws them.
	switch (column) {
		case "title": {
			const link = cell.createEl("a", { cls: "pt-table-title", text: task.name });
			link.addEventListener("click", (event) => {
				event.preventDefault();
				if (event.ctrlKey || event.metaKey) host.openTask(task, true);
				else host.editTask(task);
			});
			// A second line in the same cell rather than a column of its own: a
			// description belongs to the task it names, and a column of prose
			// would take width from every other one.
			if (showDescription && task.descriptionSnippet) {
				cell.createDiv({ cls: "pt-table-desc", text: task.descriptionSnippet });
			}
			break;
		}
		case "prioritized":
			priorityFlag(cell, task);
			break;
		default:
			taskField(cell, project, task, column);
	}
}

function renderRows(
	body: HTMLElement,
	columns: TableColumn[],
	project: Project,
	tasks: Task[],
	host: TaskHost,
	showDescription: boolean
): void {
	for (const task of tasks) {
		const row = body.createEl("tr", { cls: "pt-row" });
		for (const column of columns)
			renderCell(row, column, project, task, host, showDescription);
		row.addEventListener("contextmenu", (event) => {
			event.preventDefault();
			host.showTaskMenu(event, task);
		});
	}
}

/**
 * The tasks of one group, or of the whole view when nothing is grouped.
 *
 * A phone gets cards rather than a table: eight columns do not fit ~390px, and
 * the same fields read fine stacked. It is the only thing that changes — the
 * array arrives already sorted, and a group does not care what draws it — so
 * sorting and grouping carry over untouched.
 */
function renderItems(
	parent: HTMLElement,
	columns: TableColumn[],
	project: Project,
	tasks: Task[],
	view: SavedView,
	host: TaskHost
): void {
	if (Platform.isPhone) {
		const list = parent.createDiv({ cls: "pt-card-list" });
		for (const task of tasks) {
			renderTaskCard(list, project, task, host, {
				showDescription: view.showDescription,
				// The columns are the extras here, so this is never the setting that
				// empties the row — a view with nothing but a title in it is.
				showExtras: true,
				display: "table",
				columns,
			});
		}
		return;
	}

	const table = parent.createEl("table", { cls: "pt-table" });
	renderHead(table, columns, view, host);
	renderRows(table.createEl("tbody"), columns, project, tasks, host, view.showDescription);
}

function renderHead(
	table: HTMLElement,
	columns: TableColumn[],
	view: SavedView,
	host: TaskHost
): void {
	const head = table.createEl("thead").createEl("tr");
	for (const column of columns) {
		const cell = head.createEl("th", { cls: `pt-head pt-head-${column}` });
		const sortField = SORTABLE[column];
		const active = view.sort.field === sortField;
		cell.toggleClass("is-sorted", active);

		// A plain <button>, so Obsidian styles it; .pt-head-button only strips the
		// control look back so a header reads as a header rather than a control.
		const button = cell.createEl("button", {
			cls: "pt-head-button",
			attr: { type: "button" },
		});

		// The flame carries the meaning on its own, but the header still needs an
		// accessible name and a tooltip once the word is gone.
		if (column === "prioritized") {
			button.setAttr("aria-label", HEADERS[column]);
			button.setAttr("title", HEADERS[column]);
			setIcon(button.createSpan(), "flame");
		} else {
			button.createSpan({ text: HEADERS[column] });
		}

		// The slot is always present and fixed-width, so sorting a column never
		// changes its width — only the arrow inside appears or disappears.
		const arrow = button.createSpan({ cls: "pt-sort-icon" });
		if (active) setIcon(arrow, view.sort.dir === "asc" ? "arrow-up" : "arrow-down");

		// Cycle unsorted → ascending → descending → unsorted.
		button.addEventListener("click", () => {
			if (!active) host.setSort(sortField, "asc");
			else if (view.sort.dir === "asc") host.setSort(sortField, "desc");
			else host.setSort(null, "desc");
		});
	}
}

/**
 * Status group heading. `.bases-group-heading` and its two children are
 * Obsidian's own and carry no positioning, so unlike the rest of the Bases
 * table they transfer intact.
 */
function renderGroupHeader(
	parent: HTMLElement,
	name: string,
	count: number,
	collapsed: boolean,
	onToggle: () => void
): void {
	const header = parent.createEl("button", {
		cls: "bases-group-heading pt-group-header",
		attr: { type: "button", "aria-expanded": String(!collapsed) },
	});
	// The state is on the element as well as on aria-expanded, because the header
	// closes off its own bottom corners when there is no table under it.
	header.toggleClass("is-collapsed", collapsed);
	setIcon(header.createSpan({ cls: "pt-group-chevron" }), collapsed ? "chevron-right" : "chevron-down");
	header.createSpan({ cls: "pt-status-dot" });
	header.createSpan({ cls: "bases-group-value", text: name });
	header.createSpan({ cls: "bases-group-property", text: String(count) });
	header.addEventListener("click", onToggle);
}

export function renderTable(
	container: HTMLElement,
	project: Project,
	tasks: Task[],
	view: SavedView,
	host: TaskHost
): void {
	const columns = normalizeColumns(
		view.columns.length ? view.columns : (["title", "status"] as TableColumn[])
	);
	const wrapper = container.createDiv({ cls: "pt-table-wrapper" });

	if (!tasks.length) {
		wrapper.createDiv({ cls: "pane-empty", text: "No tasks match this view." });
		return;
	}

	if (view.groupBy === "none") {
		renderItems(wrapper, columns, project, tasks, view, host);
		return;
	}

	for (const group of buildGroups(project, tasks, view.groupBy)) {
		const collapsed = host.collapsedGroups.has(group.key);

		const el = wrapper.createDiv({ cls: "pt-group" });
		el.style.setProperty("--pt-status-color", group.color);

		renderGroupHeader(el, group.name, group.tasks.length, collapsed, () =>
			host.toggleGroup(group.key)
		);

		if (collapsed) continue;
		renderItems(el, columns, project, group.tasks, view, host);
	}
}
