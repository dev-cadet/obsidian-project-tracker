import type { Project, SortField, Task } from "../../types";
import type { TaskActions } from "../shared/TaskCard";

/** Everything the project page can do, on top of what a card alone needs. */
export interface TaskHost extends TaskActions {
	project: Project;
	collapsedGroups: Set<string>;
	moveTask(task: Task, statusKey: string): void;
	createTask(statusKey?: string): void;
	/** A null field clears sorting. */
	setSort(field: SortField | null, dir: "asc" | "desc"): void;
	toggleGroup(key: string): void;
}
