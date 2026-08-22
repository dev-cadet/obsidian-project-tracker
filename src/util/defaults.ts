import type {
	BoardConfig,
	LabelOption,
	SavedView,
	StatusOption,
	ViewFilters,
} from "../types";

/** GitHub-ish accents offered as swatches when picking a project colour. */
export const PROJECT_COLOR_PRESETS = [
	"#0969da",
	"#1a7f37",
	"#8250df",
	"#bf3989",
	"#bc4c00",
	"#9a6700",
	"#0e7490",
	"#6e7781",
];

export const DEFAULT_PROJECT_COLOR = PROJECT_COLOR_PRESETS[0];

/** Used for a project that has never picked one. Any Lucide id works here. */
export const DEFAULT_PROJECT_ICON = "layout-dashboard";

export function defaultStatuses(): Record<string, StatusOption> {
	return {
		backlog: {
			name: "Backlog",
			color: "#ffffff",
			nextStatus: "upcoming",
			warnStart: false,
			warnDue: true,
			autoStatusChange: null,
		},
		upcoming: {
			name: "Upcoming",
			color: "#9a6700",
			nextStatus: "in-progress",
			warnStart: false,
			warnDue: true,
			autoStatusChange: null,
		},
		"in-progress": {
			name: "In Progress",
			color: "#0969da",
			nextStatus: "complete",
			warnStart: false,
			warnDue: true,
			autoStatusChange: null,
		},
		complete: {
			name: "Completed",
			color: "#1a7f37",
			nextStatus: "archived",
			// Nothing left to overrun: work that is done cannot be late.
			warnStart: false,
			warnDue: false,
			autoStatusChange: "30d",
		},
		archived: {
			name: "Archived",
			color: "#8250df",
			nextStatus: null,
			// Nothing left to overrun: work that is done cannot be late.
			warnStart: false,
			warnDue: false,
			autoStatusChange: null,
		},
	};
}

export function defaultLabels(): Record<string, LabelOption> {
	return {
		bug: { name: "Bug", color: "#d1242f" },
		feature: { name: "Feature", color: "#0969da" },
		chore: { name: "Chore", color: "#6e7781" },
	};
}

export function emptyFilters(): ViewFilters {
	return { status: [], labels: [], prioritized: null, date: null };
}

export function defaultColumns(): SavedView["columns"] {
	return ["title", "status", "labels", "due", "created"];
}

export function defaultBoardConfig(): BoardConfig {
	return {
		defaultView: "board",
		openTasksInBoard: true,
		views: [
			{
				id: "board",
				name: "Board",
				type: "kanban",
				// Stated as a filter rather than hidden logic: these are the columns
				// the board opens with, and they are editable like any other view.
				filters: { ...emptyFilters(), status: ["upcoming", "in-progress", "complete"] },
				groupBy: "status",
				showDescription: true,
				sort: { field: "task-created", dir: "desc" },
				columns: defaultColumns(),
			},
			{
				id: "backlog",
				name: "Backlog",
				type: "table",
				// Names only what it wants, so adding a status never touches this view.
				filters: { ...emptyFilters(), status: ["backlog"] },
				// Already filtered to a single status, so grouping by status would
				// only wrap the table in one redundant header.
				groupBy: "none",
				showDescription: false,
				sort: { field: "task-created", dir: "desc" },
				columns: defaultColumns(),
			},
			{
				id: "all-tasks",
				name: "All tasks",
				type: "table",
				filters: emptyFilters(),
				groupBy: "none",
				showDescription: false,
				sort: { field: "task-created", dir: "desc" },
				columns: defaultColumns(),
			},
		],
	};
}
