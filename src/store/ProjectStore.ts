import {
	App,
	CachedMetadata,
	Plugin,
	TAbstractFile,
	TFile,
	TFolder,
	debounce,
	parseFrontMatterTags,
} from "obsidian";
import type { Project, Task } from "../types";
import { readProject } from "../io/projectFile";
import { readTask } from "../io/taskFile";
import { type FileKind, classifyTags } from "./classify";
import { renamedPath } from "../util/paths";

type Listener = () => void;

/**
 * Frontmatter tags only, never the body's. A note declares what it is; merely
 * mentioning #ProjectConfig in prose must not turn it into one — which a change
 * log entry, a quoted field value or a page of documentation all otherwise do.
 */
function classify(cache: CachedMetadata | null): FileKind {
	if (!cache) return null;
	return classifyTags(parseFrontMatterTags(cache.frontmatter) ?? []);
}

export class ProjectStore {
	private projects = new Map<string, Project>();
	private tasks = new Map<string, Task>();
	private listeners = new Set<Listener>();
	private indexed = false;

	/**
	 * Files and folders a rename has moved, waiting to be read at where they now
	 * are. See settle() for why they are not read as the events arrive.
	 */
	private movedFiles = new Set<string>();
	private movedFolders = new Set<string>();

	private notify = debounce(() => {
		for (const listener of this.listeners) listener();
	}, 80, true);

	/**
	 * Re-read what a rename moved, once the vault has finished moving it.
	 *
	 * Renaming a folder is not one event. The vault re-keys its file map entry by
	 * entry and reports each one, and while that is running the tree is halfway
	 * between two shapes: a note can already be at its new path while the folder
	 * above it is still filed under the old one. TFile.parent is resolved by
	 * looking the parent path up in that map, so a note reported mid-cascade can
	 * arrive with a null parent — and readProject returns null without one, which
	 * is what dropped a project off the plugin until the next full scan.
	 *
	 * So nothing is read while the events are arriving. They only record what
	 * moved; this runs once they stop, against a tree that has settled.
	 */
	private settle = debounce(() => void this.reconcile(), 50, true);

	constructor(
		private app: App,
		private plugin: Plugin
	) {}

	/**
	 * False until the first full scan finishes. Views are restored before that,
	 * so without it an empty index is indistinguishable from an empty vault and
	 * a project that exists reads as missing.
	 */
	get ready(): boolean {
		return this.indexed;
	}

	onChange(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	registerEvents(): void {
		const { app, plugin } = this;

		plugin.registerEvent(
			app.metadataCache.on("changed", (file, data, cache) => {
				if (this.ingest(file, data, cache)) this.notify();
			})
		);
		plugin.registerEvent(
			app.vault.on("delete", (file: TAbstractFile) => {
				if (this.projects.delete(file.path) || this.tasks.delete(file.path)) {
					this.notify();
				}
			})
		);
		plugin.registerEvent(
			app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
				// Everything indexed under the old path is now filed under a path
				// nothing is at, whether one note moved or a folder above thousands
				// did. Dropping the stale keys is all that happens now; reading is
				// left to settle().
				this.forget(oldPath, file.path);

				if (file instanceof TFolder) this.movedFolders.add(file.path);
				else this.movedFiles.add(file.path);

				// No notify here. The entry is about to come back under its new path,
				// and saying it had gone first is what made a view flash its
				// not-found screen on every rename.
				this.settle();
			})
		);
	}

	/**
	 * Drop what a rename moved, and queue it to be read at where it went.
	 *
	 * Prefix-matched rather than keyed on the event's own path: renaming a
	 * project's parent folder moves the config note without ever naming it, and
	 * the entry filed under its old path has to go either way.
	 */
	private forget(oldPath: string, newPath: string): void {
		for (const map of [this.projects, this.tasks]) {
			for (const path of [...map.keys()]) {
				const moved = renamedPath(path, oldPath, newPath);
				if (!moved) continue;
				map.delete(path);
				this.movedFiles.add(moved);
			}
		}
	}

	/**
	 * Read everything a rename moved, now that the vault agrees where it is.
	 *
	 * A moved folder is walked rather than having its descendants' paths worked
	 * out here: the vault's own tree is the thing that knows what is inside it,
	 * and by now it is the settled one. That also picks up anything the plugin
	 * had never indexed — a note whose ProjectConfig tag was added while it sat
	 * in a folder that has since been renamed.
	 */
	private async reconcile(): Promise<void> {
		const files = [...this.movedFiles];
		const folders = [...this.movedFolders];
		this.movedFiles.clear();
		this.movedFolders.clear();

		const targets = new Map<string, TFile>();
		for (const path of files) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) targets.set(file.path, file);
		}
		for (const path of folders) {
			const folder = this.app.vault.getAbstractFileByPath(path);
			if (folder instanceof TFolder) {
				for (const file of markdownUnder(folder)) targets.set(file.path, file);
			}
		}

		const results = await Promise.all(
			[...targets.values()].map((file) => this.reindexFile(file))
		);
		// Always, not only when something changed: the entries were dropped when
		// the rename was reported, so even a re-read that finds nothing new has
		// left the index different from what the views were last shown.
		if (results.length || files.length || folders.length) this.notify();
	}

	async reindexAll(): Promise<void> {
		this.projects.clear();
		this.tasks.clear();
		await Promise.all(
			this.app.vault.getMarkdownFiles().map((file) => this.reindexFile(file))
		);
		this.indexed = true;
		this.notify();
	}

	/** True when the index changed, so a caller knows whether to notify. */
	private async reindexFile(file: TFile): Promise<boolean> {
		const cache = this.app.metadataCache.getFileCache(file);
		// Not one of ours, or not one of ours any more — which is a change if it
		// was in the index a moment ago.
		if (classify(cache) === null) {
			return this.projects.delete(file.path) || this.tasks.delete(file.path);
		}
		return this.ingest(file, await this.app.vault.cachedRead(file), cache);
	}

	private ingest(file: TFile, data: string, cache: CachedMetadata | null): boolean {
		const kind = classify(cache);

		if (kind === "project") {
			const project = readProject(this.app, file, data);
			if (project) {
				this.projects.set(file.path, project);
				return true;
			}
		} else if (kind === "task") {
			const task = readTask(this.app, file, data);
			if (task) {
				this.tasks.set(file.path, task);
				return true;
			}
		}

		// Covers a note that just gained an ignore tag, or lost its tag entirely.
		return this.projects.delete(file.path) || this.tasks.delete(file.path);
	}

	getProjects(): Project[] {
		return [...this.projects.values()].sort((a, b) => a.title.localeCompare(b.title));
	}

	getProjectByConfigPath(path: string): Project | null {
		return this.projects.get(path) ?? null;
	}

	getProjectById(id: string): Project | null {
		return this.getProjects().find((p) => p.id === id) ?? null;
	}

	/** The project whose folder contains this file, used to scope "new task" from a note. */
	getProjectForFile(file: TFile): Project | null {
		let best: Project | null = null;
		for (const project of this.projects.values()) {
			const prefix = `${project.folder.path}/`;
			if (file.path.startsWith(prefix) || file.path === project.configFile.path) {
				if (!best || project.folder.path.length > best.folder.path.length) best = project;
			}
		}
		return best;
	}

	getTasks(projectId: string): Task[] {
		return [...this.tasks.values()].filter((task) => task.projectId === projectId);
	}

	getTaskByPath(path: string): Task | null {
		return this.tasks.get(path) ?? null;
	}

	/** Tasks naming this one as their parent, in the order they were indexed. */
	getChildTasks(parentPath: string): Task[] {
		return [...this.tasks.values()].filter((task) => task.parentPath === parentPath);
	}

	getAllTasks(): Task[] {
		return [...this.tasks.values()];
	}
}

/** Every markdown file inside a folder, however deep. */
function markdownUnder(folder: TFolder): TFile[] {
	const found: TFile[] = [];
	const walk = (current: TFolder): void => {
		for (const child of current.children) {
			if (child instanceof TFolder) walk(child);
			else if (child instanceof TFile && child.extension === "md") found.push(child);
		}
	};
	walk(folder);
	return found;
}
