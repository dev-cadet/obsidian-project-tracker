import { AbstractInputSuggest, App, TFolder } from "obsidian";

/**
 * Obsidian's native input autocomplete, bound to a text field holding a folder path.
 * Non-empty folders are flagged inline because new projects require an empty one.
 */
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(
		app: App,
		private inputEl: HTMLInputElement,
		private onPick: (folder: TFolder) => void
	) {
		super(app, inputEl);
		this.limit = 50;
	}

	protected getSuggestions(query: string): TFolder[] {
		const needle = query.toLowerCase().trim();
		const folders = this.app.vault.getAllFolders(true);
		const matches = needle
			? folders.filter((folder) => folder.path.toLowerCase().includes(needle))
			: folders;

		return matches.sort((a, b) => {
			if (needle) {
				const aStarts = a.path.toLowerCase().startsWith(needle);
				const bStarts = b.path.toLowerCase().startsWith(needle);
				if (aStarts !== bStarts) return aStarts ? -1 : 1;
			}
			return a.path.localeCompare(b.path);
		});
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.addClass("pt-folder-suggestion");
		el.createDiv({ text: folder.path === "/" ? "Vault root" : folder.path });
		if (folder.children.length) {
			el.createEl("small", {
				cls: "pt-folder-suggestion-hint",
				text: `${folder.children.length} item${folder.children.length === 1 ? "" : "s"} inside`,
			});
		} else {
			el.createEl("small", { cls: "pt-folder-suggestion-hint is-empty", text: "empty" });
		}
	}

	selectSuggestion(folder: TFolder): void {
		const path = folder.path === "/" ? "" : folder.path;
		this.inputEl.value = path;
		this.inputEl.trigger("input");
		this.onPick(folder);
		this.close();
	}
}
