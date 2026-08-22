import { setIcon } from "obsidian";
import type { Project, TableColumn, Task } from "../../types";
import { formatDisplayDate, isOverdue } from "../../util/dates";

export function statusPill(parent: HTMLElement, project: Project, statusKey: string): HTMLElement {
	const status = project.statuses[statusKey];
	const pill = parent.createSpan({ cls: "pt-status-pill" });
	pill.style.setProperty("--pt-status-color", status?.color ?? "#6e7781");
	pill.createSpan({ cls: "pt-status-dot" });
	pill.createSpan({ text: status?.name ?? statusKey ?? "No status" });
	return pill;
}

export function labelChips(parent: HTMLElement, project: Project, labels: string[]): void {
	if (!labels.length) return;
	const row = parent.createDiv({ cls: "pt-label-row" });
	for (const key of labels) {
		const label = project.labels[key];
		const chip = row.createSpan({ cls: "pt-label", text: label?.name ?? key });
		chip.style.setProperty("--pt-chip-color", label?.color ?? "#6e7781");
	}
}

/**
 * The icon for each date a task carries, named once so the board and the table
 * cannot drift apart on what a date looks like.
 */
const DATE_ICON = {
	start: "calendar-clock",
	due: "calendar-check",
	created: "calendar-plus",
	modified: "calendar-range",
} as const;

/**
 * The shared look for a date, wherever one is shown: icon, then the same
 * formatting every other date in the plugin uses. Returns the chip so a caller
 * can add a state to it, and nothing at all when there is no date to show.
 */
function dateChip(parent: HTMLElement, value: string | null, icon: string): HTMLElement | null {
	if (!value) return null;
	const chip = parent.createSpan({ cls: "pt-date" });
	setIcon(chip.createSpan({ cls: "pt-date-icon" }), icon);
	chip.createSpan({ text: formatDisplayDate(value) });
	return chip;
}

/**
 * Whether a date on this task reads as overrun.
 *
 * Two things have to agree: the date has passed, and the status the task sits in
 * warns about that date. A completed task has not overrun anything, whatever its
 * dates say — which is the whole point of the per-status flags.
 */
function overruns(project: Project, task: Task, field: "start" | "due"): boolean {
	const value = field === "start" ? task.start : task.due;
	if (!value || !isOverdue(value)) return false;
	// A status the config no longer lists has no flags to honour, so it says
	// nothing rather than guessing.
	const status = project.statuses[task.status];
	return field === "start" ? status?.warnStart === true : status?.warnDue === true;
}

/**
 * The dates on a card: a start, a due, or the span from one to the other.
 *
 * One chip whichever it is, rather than two sitting side by side — a start and a
 * due are one fact about a task, and reading them as a span is the point. The
 * arrow only appears when there are two ends for it to run between.
 */
export function taskDates(parent: HTMLElement, project: Project, task: Task): void {
	if (!task.start && !task.due) return;

	const chip = parent.createSpan({ cls: "pt-date" });
	const span = Boolean(task.start && task.due);

	// An icon on each end rather than one in front of the pair: the two dates do
	// not mean the same thing, and a lone date has to say which of them it is.
	const end = (field: "start" | "due", value: string): void => {
		const el = chip.createSpan({ cls: "pt-date-end" });
		setIcon(el.createSpan({ cls: "pt-date-icon" }), DATE_ICON[field]);
		el.createSpan({ text: formatDisplayDate(value) });

		// With two ends only the one that overran colours, icon included: the
		// other end has not, and reddening it says the wrong thing about it. With
		// one the chip is that date, so all of it does.
		if (overruns(project, task, field)) (span ? el : chip).addClass("is-overdue");
	};

	if (task.start) end("start", task.start);
	if (span) setIcon(chip.createSpan({ cls: "pt-date-arrow" }), "arrow-right");
	if (task.due) end("due", task.due);
}

export function dueChip(parent: HTMLElement, project: Project, task: Task): void {
	const chip = dateChip(parent, task.due, DATE_ICON.due);
	if (chip && overruns(project, task, "due")) chip.addClass("is-overdue");
}

export function startChip(parent: HTMLElement, project: Project, task: Task): void {
	const chip = dateChip(parent, task.start, DATE_ICON.start);
	if (chip && overruns(project, task, "start")) chip.addClass("is-overdue");
}

export function createdChip(parent: HTMLElement, created: string | null): void {
	dateChip(parent, created, DATE_ICON.created);
}

export function modifiedChip(parent: HTMLElement, modified: string | null): void {
	dateChip(parent, modified, DATE_ICON.modified);
}

/**
 * One column's value, drawn the same way wherever it is shown — a cell on a
 * screen wide enough for a table, a line of a card's footer on one that is not.
 * Named once so the two forms of the same view cannot drift apart on what a
 * status or a date looks like.
 *
 * Title and priority are absent because neither is a chip: a table draws them as
 * a link and a centred icon in columns of their own, and a card as its name and
 * the mark beside it.
 */
export function taskField(
	parent: HTMLElement,
	project: Project,
	task: Task,
	column: TableColumn
): void {
	switch (column) {
		case "status":
			statusPill(parent, project, task.status);
			break;
		case "labels":
			labelChips(parent, project, task.labels);
			break;
		case "start":
			startChip(parent, project, task);
			break;
		case "due":
			dueChip(parent, project, task);
			break;
		case "created":
			createdChip(parent, task.created);
			break;
		case "modified":
			modifiedChip(parent, task.modified);
			break;
	}
}

export function priorityFlag(parent: HTMLElement, task: Task): void {
	if (!task.prioritized) return;
	const flag = parent.createSpan({ cls: "pt-priority", attr: { "aria-label": "Prioritized" } });
	setIcon(flag, "flame");
}
