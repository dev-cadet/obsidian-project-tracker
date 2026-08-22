import { setIcon } from "obsidian";
import type { Project, SavedView } from "../../../types";
import { Button } from "../../../ui/Button";

interface HeaderCallbacks {
	onConfigure: () => void;
	onSelectView: (view: SavedView) => void;
	onNewView: () => void;
}

/**
 * Project name, its icon as the route into configuration, and the strip of
 * saved views.
 *
 * `heading` is off where the app's own view header is showing — on mobile, where
 * that header is the navigation and cannot be hidden. Two title rows stacked is
 * one row of a phone spent saying the same thing twice, so the name and the
 * route into configuration move into the header that is already there: the title
 * is `getDisplayText`, and configuration is an item in the pane menu behind its
 * `...` button.
 */
export function renderProjectHeader(
	parent: HTMLElement,
	project: Project,
	active: SavedView,
	callbacks: HeaderCallbacks,
	heading = true
): void {
	const header = parent.createDiv({ cls: "pt-project-page-header" });

	if (heading) {
		const row = header.createDiv({ cls: "pt-project-page-heading" });
		new Button(row, {
			icon: project.icon,
			tooltip: "Project configuration",
			onClick: callbacks.onConfigure,
		});
		row.createEl("h2", { cls: "pt-project-page-title", text: project.title });
	}

	const tabs = header.createDiv({ cls: "pt-project-page-tabs" });
	for (const saved of project.board.views) {
		// A raw <button> rather than the Button component: a tab carries an icon
		// *and* a label, and ButtonComponent's setIcon and setButtonText overwrite
		// each other. Obsidian still styles the element, and mod-cta is its own
		// way of marking the selected one.
		const tab = tabs.createEl("button", { cls: "pt-project-page-tab", attr: { type: "button" } });
		tab.toggleClass("mod-cta", saved.id === active.id);
		setIcon(
			tab.createSpan({ cls: "pt-project-page-tab-icon" }),
			saved.type === "kanban" ? "columns-3" : "table"
		);
		tab.createSpan({ text: saved.name });
		tab.addEventListener("click", () => callbacks.onSelectView(saved));
	}

	// Shaped like the tabs it sits beside, so the strip reads as one row standing
	// on the line. Icon only, with the label on the tooltip, so it still reads as
	// an action rather than as another view.
	new Button(tabs, {
		icon: "plus",
		tooltip: "New view",
		class: "pt-project-page-tab",
		onClick: callbacks.onNewView,
	});
}
