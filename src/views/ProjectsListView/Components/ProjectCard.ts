import { setIcon } from "obsidian";
import type { Project, Task } from "../../../types";
import type { ProjectListConfig } from "../../../modals/ProjectListConfigModal";
import { buildGroups } from "../../ProjectView/grouping";

/**
 * Which of the two projects displays a card is being drawn into.
 *
 * They are not the same display and do not track each other: the page is a wall
 * of tiles browsed at a glance, the dock a narrow column read top to bottom.
 * Only the frame below is shared — what goes in it is per display, so a change
 * to one is a change to one.
 */
export type ProjectCardDisplay = "page" | "dock";

/**
 * One project, drawn as a card.
 *
 * The markup is Obsidian's own: `.community-item` and its parts are what the
 * plugin browser uses for exactly this shape — a bordered, rounded, clickable
 * tile with a name, a muted metadata line and a description — so the border,
 * radius, padding, hover and focus ring all come from the app and this file
 * ships no styling of its own beyond the project's colour, which nothing stock
 * can express — it travels as a custom property for the stylesheet to use.
 *
 * Returns the card so a caller can add behaviour of its own — the page makes it
 * draggable that way, and the dock deliberately does not.
 */
export function renderProjectCard(
	parent: HTMLElement,
	project: Project,
	tasks: Task[],
	options: ProjectListConfig,
	display: ProjectCardDisplay,
	onOpen: () => void
): HTMLElement {
	// role and tabindex because a div is not focusable, and the app already
	// styles .community-item:focus-visible for keyboard users.
	const card = parent.createDiv({
		cls: "community-item",
		attr: { role: "button", tabindex: "0" },
	});
	card.style.setProperty("--pt-card-color", project.color);

	const name = card.createDiv({ cls: "community-item-name" });
	setIcon(name.createSpan({ cls: "pt-card-icon" }), project.icon);
	name.createSpan({ text: project.title });

	if (display === "page") renderPageBody(card, project, tasks, options);
	else renderDockBody(card, project, tasks, options);

	card.addEventListener("click", onOpen);
	card.addEventListener("keydown", (event) => {
		if (event.key !== "Enter" && event.key !== " ") return;
		event.preventDefault();
		onOpen();
	});

	return card;
}

/** The full page: description, then what the project is made of. */
function renderPageBody(
	card: HTMLElement,
	project: Project,
	tasks: Task[],
	options: ProjectListConfig
): void {
	// First line only — a card is not the place for a whole description.
	if (options.showDescription && project.description) {
		card.createDiv({
			cls: "community-item-desc",
			text: project.description.split("\n")[0],
		});
	}

	if (!options.showCount) return;

	const row = card.createDiv({ cls: "pt-card-statuses" });

	// The same split the board and table group by, so a card can never disagree
	// with the board about what is in a project: config order, empty statuses
	// dropped, and a status a task claims that the config has never heard of
	// still counted rather than silently missing.
	const groups = buildGroups(project, tasks, "status");
	if (!groups.length) {
		row.createSpan({ cls: "pt-card-status is-empty", text: "No tasks" });
		return;
	}

	for (const group of groups) {
		const item = row.createSpan({ cls: "pt-card-status" });
		item.style.setProperty("--pt-status-color", group.color);
		item.createSpan({ cls: "pt-status-dot" });
		item.createSpan({ text: group.name });
		item.createSpan({
			cls: "pt-card-status-count",
			text: String(group.tasks.length),
		});
	}
}

/**
 * Docked in a sidebar: one total above the description, in the slot the plugin
 * browser gives an author. A narrow column has no width for a per-status split.
 */
function renderDockBody(
	card: HTMLElement,
	project: Project,
	tasks: Task[],
	options: ProjectListConfig
): void {
	if (options.showCount) {
		card.createDiv({
			cls: "community-item-author",
			text: `${tasks.length} task${tasks.length === 1 ? "" : "s"}`,
		});
	}

	if (options.showDescription && project.description) {
		card.createDiv({
			cls: "community-item-desc",
			text: project.description.split("\n")[0],
		});
	}
}
