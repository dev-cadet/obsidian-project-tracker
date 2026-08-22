import { DropdownComponent, SearchComponent } from "obsidian";
import { parseGroupBy } from "../../../types";
import type { SavedView } from "../../../types";
import { Button } from "../../../ui/Button";

/** What the row still holds, once mobile has moved the rest to the pane menu. */
export interface ToolbarOptions {
	/** Off on a phone board: the pane menu carries the column picker instead. */
	search: boolean;
	/** Off on a phone: the pane menu carries a Group submenu instead. */
	group: boolean;
	/** Off on mobile: New task and Configure are pane-menu items there. */
	actions: boolean;
}

interface ToolbarCallbacks {
	onSearch: (value: string) => void;
	onConfigure: () => void;
	onChangeView: (view: SavedView) => void;
	onNewTask: () => void;
}

/** A labelled control, for the pairs that need a word to be readable. */
function field(parent: HTMLElement, label: string): HTMLElement {
	const wrap = parent.createDiv({ cls: "pt-project-page-toolbar-field" });
	wrap.createSpan({ cls: "pt-project-page-toolbar-field-label", text: label });
	return wrap;
}

/**
 * Sorting is deliberately absent: a table sorts by clicking its column headers,
 * and a board's order is a property of the view, set in the configure modal.
 */
export function renderProjectToolbar(
	parent: HTMLElement,
	view: SavedView,
	search: string,
	callbacks: ToolbarCallbacks,
	options: ToolbarOptions = { search: true, group: true, actions: true }
): void {
	const toolbar = parent.createDiv({ cls: "pt-project-page-toolbar" });

	if (options.search) {
		// SearchComponent brings the app's search field and its clear button.
		new SearchComponent(toolbar)
			.setPlaceholder("Filter tasks…")
			.setValue(search)
			.onChange(callbacks.onSearch);
	}

	const right = toolbar.createDiv({ cls: "pt-project-page-toolbar-end" });

	if (view.type === "table" && options.group) {
		const group = new DropdownComponent(field(right, "Group"))
			.addOption("none", "None")
			.addOption("status", "Status")
			.addOption("label", "Label")
			.setValue(view.groupBy)
			.onChange((value) => {
				callbacks.onChangeView({ ...view, groupBy: parseGroupBy(value) });
			});
		group.selectEl.addClass("pt-input-style-flat");
	}

	if (options.actions) {
		// Lives here rather than inside the active tab, so switching tabs never
		// changes their widths.
		new Button(right, {
			icon: "sliders-horizontal",
			tooltip: `Configure "${view.name}"`,
			class: "pt-btn-style-flat",
			onClick: callbacks.onConfigure,
		});

		new Button(right, {
			text: "New task",
			variant: "cta",
			class: "pt-new-task",
			onClick: callbacks.onNewTask,
		});
	}

	// A phone board has nothing left in either: the search box is gone, and the
	// two buttons and the column picker are all items in the pane menu now. An
	// empty row is a row of screen spent on nothing, so it is not drawn at all.
	if (!right.childElementCount) right.remove();
	if (!toolbar.childElementCount) toolbar.remove();
}
