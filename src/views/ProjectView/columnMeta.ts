import type { SortField, TableColumn } from "../../types";

export const COLUMN_HEADERS: Record<TableColumn, string> = {
	prioritized: "Priority",
	title: "Title",
	status: "Status",
	labels: "Labels",
	start: "Start",
	due: "Due",
	created: "Created",
	modified: "Modified",
};

/**
 * A view's stored order is the table's order — the config modal lets it be
 * dragged, so it means something. This only drops keys the build no longer
 * knows and any duplicate, which would otherwise render a column twice.
 */
export function normalizeColumns(columns: TableColumn[]): TableColumn[] {
	const known = new Set(Object.keys(COLUMN_HEADERS) as TableColumn[]);
	const seen = new Set<TableColumn>();
	return columns.filter((column) => {
		if (!known.has(column) || seen.has(column)) return false;
		seen.add(column);
		return true;
	});
}

/** Left-to-right order a view starts with before anything is dragged. */
export function canonicalColumns(): TableColumn[] {
	return Object.keys(COLUMN_HEADERS) as TableColumn[];
}

/** Every column is sortable, so no header is a dead click target. */
export const COLUMN_SORT: Record<TableColumn, SortField> = {
	prioritized: "task-prioritized",
	title: "task-name",
	status: "task-status",
	labels: "task-labels",
	start: "task-start",
	due: "task-due",
	created: "task-created",
	modified: "task-modified",
};
