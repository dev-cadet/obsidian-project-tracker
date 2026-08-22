import type { Project, Task } from "../../../types";
import type { TaskHost } from "../TaskHost";
import { Button } from "../../../ui/Button";
import { renderTaskCard } from "../../shared/TaskCard";

/** dataTransfer payloads are unreadable during dragover, so track the drag here. */
let draggingPath: string | null = null;

/**
 * One end of the column stepper. Disabled rather than hidden at the edges, so
 * the header keeps its shape and the title stays where it was.
 */
function step(header: HTMLElement, cycle: ColumnCycle, end: "previous" | "next"): void {
	const target = cycle[end];
	new Button(header, {
		icon: end === "previous" ? "chevron-left" : "chevron-right",
		tooltip: end === "previous" ? "Previous column" : "Next column",
		class: "pt-column-step",
		disabled: target === null,
		onClick: () => {
			if (target) cycle.onSelect(target);
		},
	});
}

/** The shared card, plus the dragging that only a board does with it. */
function renderCard(
	parent: HTMLElement,
	project: Project,
	task: Task,
	host: TaskHost,
	showDescription: boolean
): void {
	const card = renderTaskCard(parent, project, task, host, {
		showDescription,
		// A board has the width for them and no setting to hide them behind.
		showExtras: true,
		display: "board",
	});

	card.setAttr("draggable", "true");
	card.addEventListener("dragstart", (event) => {
		draggingPath = task.file.path;
		card.addClass("is-dragging");
		event.dataTransfer?.setData("text/plain", task.file.path);
		if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
	});
	card.addEventListener("dragend", () => {
		draggingPath = null;
		card.removeClass("is-dragging");
	});
}

/**
 * Stepping between columns, where only one of them is on screen.
 *
 * Each end is the column to move to or null at the edge, so the header does not
 * have to know the order to know whether it has run out of it.
 */
export interface ColumnCycle {
	previous: string | null;
	next: string | null;
	onSelect: (key: string) => void;
}

/**
 * `visible` is what gets drawn, already narrowed — on a phone the view cuts it to
 * one column and passes a `cycle` to move between them. Everything else about a
 * board is the same either way.
 */
export function renderBoard(
	container: HTMLElement,
	project: Project,
	tasks: Task[],
	visible: string[],
	host: TaskHost,
	showDescription: boolean,
	cycle: ColumnCycle | null = null
): void {
	const board = container.createDiv({ cls: "pt-board" });

	if (!visible.length) {
		board.createDiv({
			cls: "pane-empty",
			text: "No columns to show. This project has no statuses in its Status Config.",
		});
		return;
	}

	for (const key of visible) {
		const status = project.statuses[key];
		if (!status) continue;
		const columnTasks = tasks.filter((task) => task.status === key);

		const column = board.createDiv({ cls: "pt-column" });
		column.style.setProperty("--pt-status-color", status.color);

		const header = column.createDiv({ cls: "pt-column-header" });

		// Stepping through columns is the header's job only where one column is all
		// there is. With the whole board on screen there is nothing to step to, and
		// the space goes to adding a task to this column instead.
		if (cycle) step(header, cycle, "previous");

		header.createSpan({ cls: "pt-status-dot" });
		header.createSpan({ cls: "pt-column-name", text: status.name });
		header.createSpan({ cls: "pt-column-count", text: String(columnTasks.length) });

		if (cycle) {
			step(header, cycle, "next");
		} else {
			new Button(header, {
				icon: "plus",
				tooltip: `New task in ${status.name}`,
				class: "pt-btn-style-flat",
				onClick: () => host.createTask(key),
			});
		}

		const body = column.createDiv({ cls: "pt-column-body" });
		for (const task of columnTasks) renderCard(body, project, task, host, showDescription);
		if (!columnTasks.length) {
			body.createDiv({ cls: "pane-empty", text: "Nothing here" });
		}

		column.addEventListener("dragover", (event) => {
			if (!draggingPath) return;
			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
			column.addClass("is-drop-target");
		});
		column.addEventListener("dragleave", (event) => {
			if (!column.contains(event.relatedTarget as Node)) column.removeClass("is-drop-target");
		});
		column.addEventListener("drop", (event) => {
			event.preventDefault();
			column.removeClass("is-drop-target");
			const path = draggingPath ?? event.dataTransfer?.getData("text/plain");
			draggingPath = null;
			const task = tasks.find((t) => t.file.path === path);
			if (task && task.status !== key) host.moveTask(task, key);
		});
	}
}
