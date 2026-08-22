import type { DateFilter, SavedView, Task, ViewFilters } from "../types";
import { parseDate, parseDuration } from "../util/dates";

function taskDate(task: Task, field: DateFilter["field"]): Date | null {
	switch (field) {
		case "task-created":
			return parseDate(task.created);
		case "task-modified":
			return parseDate(task.modified);
		case "task-start":
			return parseDate(task.start);
		case "task-due":
			return parseDate(task.due);
		case "task-status-modified":
			return parseDate(task.statusModified);
	}
}

function matchesDate(task: Task, filter: DateFilter): boolean {
	const value = taskDate(task, filter.field);
	if (!value) return false;

	if (filter.op === "within-last" || filter.op === "older-than") {
		const duration = parseDuration(filter.value);
		if (duration == null) return true;
		const cutoff = Date.now() - duration;
		return filter.op === "within-last" ? value.getTime() >= cutoff : value.getTime() < cutoff;
	}

	const boundary = parseDate(filter.value);
	if (!boundary) return true;
	return filter.op === "before"
		? value.getTime() < boundary.getTime()
		: value.getTime() > boundary.getTime();
}

export function filterTasks(tasks: Task[], filters: ViewFilters, search = ""): Task[] {
	const needle = search.trim().toLowerCase();
	return tasks.filter((task) => {
		// filters.status is an inclusion list: selected statuses are shown, and an
		// empty list means every status. A view like Backlog then names only what
		// it wants and is unaffected by new statuses being added later.
		if (filters.status.length && !filters.status.includes(task.status)) return false;
		if (filters.labels.length && !filters.labels.some((l) => task.labels.includes(l))) {
			return false;
		}
		if (filters.prioritized !== null && task.prioritized !== filters.prioritized) return false;
		if (filters.date && !matchesDate(task, filters.date)) return false;
		if (needle) {
			const haystack = `${task.name} ${task.descriptionSnippet} ${task.labels.join(" ")}`;
			if (!haystack.toLowerCase().includes(needle)) return false;
		}
		return true;
	});
}

/**
 * The tasks that may be made the parent of `task`.
 *
 * Everything except the task itself and anything already beneath it. Assigning a
 * descendant as a parent would close the chain into a loop, and every walk up it
 * — the card's parent row, the children list, anything built on this later —
 * would run forever. Cheaper to make the loop unselectable than to defend
 * against it everywhere afterwards.
 */
export function parentCandidates(tasks: Task[], task: Task): Task[] {
	const byPath = new Map(tasks.map((candidate) => [candidate.file.path, candidate]));

	const descendsFromTask = (candidate: Task): boolean => {
		// A guard against a loop that already exists in the data: without it a
		// corrupted chain would hang here rather than at the point it is walked.
		const seen = new Set<string>();
		let current: Task | undefined = candidate;
		while (current && !seen.has(current.file.path)) {
			seen.add(current.file.path);
			if (current.parentPath === task.file.path) return true;
			current = current.parentPath ? byPath.get(current.parentPath) : undefined;
		}
		return false;
	};

	return tasks.filter(
		(candidate) => candidate.file.path !== task.file.path && !descendsFromTask(candidate)
	);
}

/**
 * Which statuses become columns on a board.
 *
 * The view's status filter is the only input, and it is an inclusion list —
 * selected statuses are shown, exactly as for tasks. Nothing selected shows
 * everything. Ordering always follows the Status Config.
 */
export function boardColumns(statusOrder: string[], selected: string[]): string[] {
	if (!selected.length) return [...statusOrder];
	return statusOrder.filter((key) => selected.includes(key));
}

export function sortTasks(
	tasks: Task[],
	sort: SavedView["sort"],
	statusOrder: string[]
): Task[] {
	// Unsorted still needs a stable order, so fall back to newest created first.
	if (sort.field === null) {
		return [...tasks].sort((a, b) => {
			const left = parseDate(a.created)?.getTime() ?? 0;
			const right = parseDate(b.created)?.getTime() ?? 0;
			return right - left || a.name.localeCompare(b.name);
		});
	}

	const direction = sort.dir === "asc" ? 1 : -1;
	const field = sort.field;

	const value = (task: Task): string | number => {
		switch (field) {
			case "task-name":
				return task.name.toLowerCase();
			case "task-status": {
				const index = statusOrder.indexOf(task.status);
				return index === -1 ? statusOrder.length : index;
			}
			// Sentinel sorts unlabelled tasks last when ascending, matching due dates.
			case "task-labels":
				return task.labels.length
					? [...task.labels].sort().join(", ").toLowerCase()
					: "￿";
			case "task-prioritized":
				return task.prioritized ? 0 : 1;
			// Same sentinel as the due date: a task with no start sorts last ascending.
			case "task-start":
				return parseDate(task.start)?.getTime() ?? Number.POSITIVE_INFINITY;
			case "task-due":
				return parseDate(task.due)?.getTime() ?? Number.POSITIVE_INFINITY;
			case "task-modified":
				return parseDate(task.modified)?.getTime() ?? 0;
			case "task-created":
				return parseDate(task.created)?.getTime() ?? 0;
		}
	};

	return [...tasks].sort((a, b) => {
		const left = value(a);
		const right = value(b);
		if (left < right) return -1 * direction;
		if (left > right) return 1 * direction;
		return a.name.localeCompare(b.name);
	});
}
