import { Platform, setIcon } from "obsidian";
import type { Project, TableColumn, Task } from "../../types";
import { labelChips, priorityFlag, taskDates, taskField } from "./chips";

/**
 * What a task card needs from whatever is showing it.
 *
 * Deliberately three members: a card only ever opens, edits or offers a menu.
 * The project page's TaskHost extends this with the rest of what a board and a
 * table need, so a surface that just lists tasks does not have to stub them.
 */
export interface TaskActions {
	/** The task at a vault path, or null when the vault no longer has it. */
	resolveTask(path: string): Task | null;
	openTask(task: Task, newLeaf: boolean): void;
	/** The default click action: edit in place rather than open the note. */
	editTask(task: Task): void;
	showTaskMenu(event: MouseEvent, task: Task): void;
}

interface TaskCardBase {
	showDescription: boolean;
	/**
	 * The row under the name — priority, labels and due date — shown or hidden as
	 * one. They are a single setting because they occupy a single line: hiding
	 * one of the three saves nothing, and hiding all three saves the line.
	 */
	showExtras: boolean;
}

/**
 * Which display is drawing the card. The board, the docked column and the
 * table's narrow form are not the same display and do not track each other —
 * only the card's frame is shared, so a change to one stays in the one it was
 * asked for.
 *
 * A union rather than a flag, so the table cannot be asked for without the
 * columns that decide what is on it.
 */
export type TaskCardOptions =
	| (TaskCardBase & { display: "board" })
	| (TaskCardBase & { display: "dock" })
	| (TaskCardBase & {
			display: "table";
			/**
			 * The columns the view shows, in the order it shows them. The card is
			 * the same statement the table makes, read downwards.
			 */
			columns: TableColumn[];
	  });

/** The columns that carry a date, which a card keeps on a row of their own. */
const DATE_COLUMNS = new Set<TableColumn>(["start", "due", "created", "modified"]);

/**
 * One row of a card's fields, in the view's own column order — or no row at all,
 * when the view asks for none of them or this task carries none.
 */
function fieldRow(
	card: HTMLElement,
	project: Project,
	task: Task,
	columns: TableColumn[]
): void {
	if (!columns.length) return;

	const row = card.createDiv({ cls: "pt-card-footer" });
	for (const column of columns) taskField(row, project, task, column);
	if (!row.childElementCount) row.remove();
}

/**
 * A task on a card, on the same `.community-item` the projects list uses —
 * Obsidian's own, so the frame, hover and focus ring come from the app. Only the
 * chips inside carry per-status and per-label colour, which nothing stock can
 * express.
 *
 * Returns the card so a caller can add behaviour of its own. The board makes it
 * draggable that way; the docked column deliberately does not, which is why
 * dragging is not wired in here.
 */
export function renderTaskCard(
	parent: HTMLElement,
	project: Project,
	task: Task,
	actions: TaskActions,
	options: TaskCardOptions
): HTMLElement {
	const card = parent.createDiv({
		cls: "community-item",
		attr: { role: "button", tabindex: "0" },
	});

	const name = card.createDiv({ cls: "community-item-name" });
	// The board and the table read priority as part of the title. The dock leaves
	// it in the footer row, where it sits with the labels and dates.
	if (options.display !== "dock") {
		name.addClass("pt-card-title");
		// A table marks it only when the view asks for that column; a board always
		// does, having no column list to consult.
		if (options.display === "board" || options.columns.includes("prioritized")) {
			priorityFlag(name, task);
		}
	}
	// Drawn whether or not "title" is among the columns. A table can be asked for
	// without it; a card cannot, because the name is not a field on the card — it
	// is what the card is, and what is tapped to open it.
	name.createSpan({ text: task.name });

	if (options.showDescription && task.descriptionSnippet) {
		card.createDiv({
			cls: "community-item-desc pt-card-desc",
			text: task.descriptionSnippet,
		});
	}

	if (options.showExtras) {
		if (options.display === "table") {
			// In the view's own column order, which the config modal lets you drag —
			// so a card reads down in the order its table reads across.
			//
			// Dates are the exception: they keep that order but sit on a row of their
			// own, so a task carrying all four does not push the status and labels
			// around while the task under it, carrying one, leaves them where they
			// were. A column of cards is scanned down, and that only works if the
			// same field is in the same place on every one of them.
			const dated = (column: TableColumn): boolean => DATE_COLUMNS.has(column);
			fieldRow(card, project, task, options.columns.filter((c) => !dated(c)));
			fieldRow(card, project, task, options.columns.filter(dated));
		} else {
			const footer = card.createDiv({ cls: "pt-card-footer" });
			if (options.display === "dock") priorityFlag(footer, task);
			// One chip for the pair rather than two: a board card has the width to
			// read a start and a due as the span between them.
			labelChips(footer, project, task.labels);
			taskDates(footer, project, task);
			// A task with no priority, labels or dates leaves it empty.
			if (!footer.childElementCount) footer.remove();
		}
	}

	// Last on the card, under everything the task says about itself: this is the
	// one line that is about something else.
	const parentTask = task.parentPath ? actions.resolveTask(task.parentPath) : null;
	if (parentTask) {
		const row = card.createDiv({ cls: "pt-card-parent" });
		setIcon(row.createSpan({ cls: "pt-card-parent-icon" }), "corner-left-up");
		const link = row.createSpan({
			cls: "pt-card-parent-link",
			text: parentTask.name,
		});
		link.addEventListener("click", (event) => {
			// Without this the card's own handler runs too and opens this task
			// rather than the one that was clicked.
			event.stopPropagation();
			actions.editTask(parentTask);
		});
	}

	const open = (event: MouseEvent | KeyboardEvent): void => {
		if (event.ctrlKey || event.metaKey) actions.openTask(task, true);
		else actions.editTask(task);
	};

	card.addEventListener("click", (event) => {
		// Touch has no right click, and long-press is already Obsidian's own
		// gesture — so on mobile a tap opens the menu rather than the editor.
		// Nothing is lost by it: the menu leads with "Edit task…", and everything
		// under that is a status move or a toggle that would otherwise mean
		// opening the editor, changing one field and saving.
		if (Platform.isMobile) {
			actions.showTaskMenu(event, task);
			return;
		}
		open(event);
	});
	card.addEventListener("keydown", (event) => {
		if (event.key !== "Enter" && event.key !== " ") return;
		event.preventDefault();
		open(event);
	});
	card.addEventListener("contextmenu", (event) => {
		event.preventDefault();
		actions.showTaskMenu(event, task);
	});

	return card;
}
