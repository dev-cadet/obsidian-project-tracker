import type { TFile, TFolder } from "obsidian";

export const TAG_PROJECT_CONFIG = "ProjectConfig";
export const TAG_PROJECT_TASK = "ProjectTask";

/**
 * Any recognised tag can be suppressed by also applying the same tag with an
 * "Ignore" suffix, so a note can document the format without being indexed.
 */
export const TAG_IGNORE_SUFFIX = "Ignore";

/** Blanket opt-out: hides a note from Project Tracker whatever else it is tagged. */
export const TAG_GLOBAL_IGNORE = "ProjectTrackerIgnore";

export const VIEW_TYPE_PROJECT = "project-tracker-project";
export const VIEW_TYPE_PROJECT_LIST = "project-tracker-list";
/** One status of one project, docked in a sidebar. */
export const VIEW_TYPE_COLUMN = "project-tracker-column";

export interface StatusOption {
	name: string;
	color: string;
	nextStatus: string | null;
	autoStatusChange: string | null;
	/** Flag a task sitting in this status once its start date has passed. */
	warnStart: boolean;
	/** Flag a task sitting in this status once its due date has passed. */
	warnDue: boolean;
}

export interface LabelOption {
	name: string;
	color: string;
}

/**
 * Mirrors Obsidian's own property types, so a value written here is the same
 * shape its native properties editor would have written for that type.
 */
export type CustomFieldType = "text" | "list" | "number" | "checkbox" | "date" | "datetime";

export interface CustomField {
	/** The frontmatter key the value is stored under. */
	key: string;
	name: string;
	type: CustomFieldType;
	/** Seeded into new tasks. Stored in the type's own shape; null means none. */
	defaultValue: unknown;
}

/** Frontmatter keys the plugin owns; a custom field may not claim one. */
export const RESERVED_TASK_KEYS = new Set([
	"tags",
	"position",
	"aliases",
	"cssclasses",
	"project-id",
	"project-file",
	"task-parent",
	"task-name",
	"task-status",
	"task-prioritized",
	"task-labels",
	"task-start",
	"task-due",
	"task-created",
	"task-modified",
	"task-status-modified",
]);

export type DateField =
	| "task-created"
	| "task-modified"
	| "task-start"
	| "task-due"
	| "task-status-modified";

export type DateOp = "within-last" | "older-than" | "before" | "after";

export interface DateFilter {
	field: DateField;
	op: DateOp;
	value: string;
}

export interface ViewFilters {
	status: string[];
	labels: string[];
	prioritized: boolean | null;
	date: DateFilter | null;
}

export type SortField =
	| "task-name"
	| "task-status"
	| "task-labels"
	| "task-prioritized"
	| "task-created"
	| "task-modified"
	| "task-start"
	| "task-due";

export type TableColumn =
	| "prioritized"
	| "title"
	| "status"
	| "labels"
	| "start"
	| "due"
	| "created"
	| "modified";

/**
 * How a table splits its rows.
 *
 * "status" is a partition — a task has one status. "label" is not: a task
 * carries any number of labels and is listed under each of them, so the group
 * counts add up to more than the number of tasks.
 */
export type GroupBy = "status" | "label" | "none";

/**
 * Anything unrecognised reads as "status", which is what a view written before
 * label grouping existed meant by saying nothing at all.
 */
export function parseGroupBy(value: unknown): GroupBy {
	return value === "none" || value === "label" ? value : "status";
}

export interface SavedView {
	id: string;
	name: string;
	type: "kanban" | "table";
	filters: ViewFilters;
	groupBy: GroupBy;
	/**
	 * Whether the description snippet is shown with each task. A board has room
	 * for it under the card title; a table does not, so it defaults on for one
	 * and off for the other — see showDescriptionDefault.
	 */
	showDescription: boolean;
	/** A null field means unsorted — tasks fall back to newest-created first. */
	sort: { field: SortField | null; dir: "asc" | "desc" };
	columns: TableColumn[];
}

/**
 * What a view shows before anyone says otherwise, and what a view written before
 * the setting existed is taken to have meant.
 */
export function showDescriptionDefault(type: SavedView["type"]): boolean {
	return type === "kanban";
}

export interface BoardConfig {
	defaultView: string;
	openTasksInBoard: boolean;
	views: SavedView[];
}

export interface Project {
	id: string;
	title: string;
	description: string;
	color: string;
	/** Any id `setIcon` accepts; falls back to DEFAULT_PROJECT_ICON when unset. */
	icon: string;
	configFile: TFile;
	folder: TFolder;
	tasksFolderPath: string;
	statuses: Record<string, StatusOption>;
	statusOrder: string[];
	labels: Record<string, LabelOption>;
	customFields: CustomField[];
	board: BoardConfig;
	/** Config blocks that failed to parse, so the board can say so instead of silently using defaults. */
	configErrors: string[];
}

export interface Task {
	file: TFile;
	projectId: string;
	name: string;
	status: string;
	prioritized: boolean;
	labels: string[];
	/**
	 * The task this one belongs under, as a vault path, resolved from the
	 * wikilink in `task-parent`. Null when there is none, and also when the link
	 * no longer finds a note — a broken parent is the same as no parent to
	 * everything that reads this.
	 */
	parentPath: string | null;
	/**
	 * When the work is meant to begin. Set by hand like the due date, and unset on
	 * most tasks — nothing in the plugin reads it yet. It exists so a timeline can
	 * be built later against data that is already there.
	 */
	start: string | null;
	due: string | null;
	created: string | null;
	modified: string | null;
	statusModified: string | null;
	descriptionSnippet: string;
	/** Frontmatter the plugin does not own, keyed as written in the note. */
	custom: Record<string, unknown>;
}

export interface NewTaskInput {
	name: string;
	status: string;
	prioritized: boolean;
	labels: string[];
	/** Vault path of the parent task, or null. Written out as a wikilink. */
	parent: string | null;
	start: string | null;
	due: string | null;
	description: string;
	custom: Record<string, unknown>;
}
