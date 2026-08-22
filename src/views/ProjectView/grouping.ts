import type { GroupBy, Project, Task } from "../../types";

/** The colour a group falls back to when nothing in the config names one. */
const NO_COLOR = "#6e7781";

export interface TaskGroup {
	/**
	 * Namespaced by mode, so collapsing a status cannot also collapse a label
	 * that happens to share its key.
	 */
	key: string;
	name: string;
	color: string;
	tasks: Task[];
}

/**
 * A table's rows, split into the sections it draws. Empty groups are dropped, so
 * what comes back is what gets rendered.
 *
 * Grouping by label is deliberately not a partition: a task with three labels
 * appears three times, once under each. Adding the group counts up will exceed
 * the number of tasks, which is the mode working rather than failing.
 */
export function buildGroups(project: Project, tasks: Task[], groupBy: GroupBy): TaskGroup[] {
	return groupBy === "label" ? labelGroups(project, tasks) : statusGroups(project, tasks);
}

function statusGroups(project: Project, tasks: Task[]): TaskGroup[] {
	const used = new Set(tasks.map((task) => task.status));

	// Config order first, then any status a task claims that the config has never
	// heard of — a renamed key still shows its tasks rather than hiding them.
	const keys = [
		...project.statusOrder.filter((key) => used.has(key)),
		...[...used].filter((key) => !project.statuses[key]),
	];

	return keys
		.map((key) => ({
			key: `status:${key}`,
			name: project.statuses[key]?.name ?? key ?? "No status",
			color: project.statuses[key]?.color ?? NO_COLOR,
			tasks: tasks.filter((task) => task.status === key),
		}))
		.filter((group) => group.tasks.length > 0);
}

function labelGroups(project: Project, tasks: Task[]): TaskGroup[] {
	const used = new Set(tasks.flatMap((task) => task.labels));

	// Same rule as statuses: the order the config lists them in, then whatever
	// else is in use. Object key order is that config order, which the config
	// modal lets you drag, so it means something.
	const keys = [
		...Object.keys(project.labels).filter((key) => used.has(key)),
		...[...used].filter((key) => !project.labels[key]),
	];

	const groups = keys
		.map((key) => ({
			key: `label:${key}`,
			name: project.labels[key]?.name ?? key,
			color: project.labels[key]?.color ?? NO_COLOR,
			tasks: tasks.filter((task) => task.labels.includes(key)),
		}))
		.filter((group) => group.tasks.length > 0);

	// Last, and only when there is something in it. Without this an unlabelled
	// task would drop out of the view entirely, which no filter asked for.
	const unlabelled = tasks.filter((task) => !task.labels.length);
	if (unlabelled.length) {
		groups.push({ key: "nolabel", name: "No labels", color: NO_COLOR, tasks: unlabelled });
	}

	return groups;
}
