import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import type { Project } from "./types";
import { VIEW_TYPE_COLUMN, VIEW_TYPE_PROJECT, VIEW_TYPE_PROJECT_LIST } from "./types";
import { DEFAULT_SETTINGS, ProjectTrackerSettingTab, type ProjectTrackerSettings } from "./settings";
import { ProjectStore } from "./store/ProjectStore";
import { ProjectView } from "./views/ProjectView/ProjectView";
import { ProjectsListView } from "./views/ProjectsListView/ProjectsListView";
import { ColumnView } from "./views/ColumnView/ColumnView";
import { NewProjectModal } from "./modals/NewProjectModal";
import { NewTaskModal } from "./modals/NewTaskModal";
import { ProjectSuggestModal } from "./modals/ProjectSuggestModal";
import { repairProjectLink, setTaskStatus } from "./io/taskFile";
import { parseDate, parseDuration } from "./util/dates";

const AUTO_STATUS_INTERVAL_MS = 6 * 60 * 60 * 1000;

const wait = (ms: number): Promise<void> =>
	new Promise((resolve) => window.setTimeout(resolve, ms));

/** On `body` while the main area shows a plugin view. See markPluginView. */
const PLUGIN_VIEW_CLASS = "pt-view-active";

const PLUGIN_VIEWS = new Set<string>([
	VIEW_TYPE_PROJECT,
	VIEW_TYPE_PROJECT_LIST,
	VIEW_TYPE_COLUMN,
]);

export default class ProjectTrackerPlugin extends Plugin {
	declare settings: ProjectTrackerSettings;
	store!: ProjectStore;

	/**
	 * Views showing something that lives in settings rather than in the vault.
	 *
	 * The store has its own version of this for vault changes. Settings are the
	 * other half: the projects arrangement is drawn by every list on screen and
	 * changed by only one of them, so the rest have to be told.
	 */
	private settingsListeners = new Set<() => void>();

	async onload(): Promise<void> {
		await this.loadSettings();

		this.store = new ProjectStore(this.app, this);
		this.store.registerEvents();

		this.registerView(VIEW_TYPE_PROJECT, (leaf) => new ProjectView(leaf, this));
		this.registerView(VIEW_TYPE_PROJECT_LIST, (leaf) => new ProjectsListView(leaf, this));
		this.registerView(VIEW_TYPE_COLUMN, (leaf) => new ColumnView(leaf, this));

		this.addRibbonIcon("folder-kanban", "Projects", () => void this.openProjectList());
		this.addSettingTab(new ProjectTrackerSettingTab(this.app, this));
		this.registerCommands();

		this.app.workspace.onLayoutReady(() => {
			void this.store
				.reindexAll()
				.then(() => this.repairProjectLinks())
				.then(() => void this.runAutoStatusChange());
		});
		this.registerInterval(
			window.setInterval(() => void this.runAutoStatusChange(), AUTO_STATUS_INTERVAL_MS)
		);

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => this.markPluginView())
		);
		// A leaf dragged between the main area and a sidebar, or closed, changes
		// what the main area is showing without changing which leaf is active.
		this.registerEvent(
			this.app.workspace.on("layout-change", () => this.markPluginView())
		);
		this.app.workspace.onLayoutReady(() => this.markPluginView());
	}

	onunload(): void {
		// registerEvent unhooks the listeners; the class is this plugin's mark on
		// an element it does not own, so it has to be taken off by hand.
		document.body.removeClass(PLUGIN_VIEW_CLASS);
	}

	/**
	 * Flags the body while the main area is showing one of the plugin's views, so
	 * the stylesheet can hide the status-bar items that only mean something for a
	 * note — word count, backlinks, properties, editor status.
	 *
	 * A class rather than the `body:has(...)` selector this replaces. That
	 * selector had to be re-evaluated on essentially any DOM change anywhere in
	 * the app, which the directory review flags as a performance hazard.
	 *
	 * Keyed to the main area's most recent leaf rather than the focused one, so
	 * clicking into a sidebar does not flicker the status bar back: the board is
	 * still what the main area is showing. A docked column is not the main area
	 * and never triggers this, which was the point of the `.mod-root` in the
	 * selector it replaces.
	 */
	private markPluginView(): void {
		const leaf = this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit);
		const type = leaf?.view.getViewType();
		document.body.toggleClass(PLUGIN_VIEW_CLASS, PLUGIN_VIEWS.has(type ?? ""));
	}

	private registerCommands(): void {
		this.addCommand({
			id: "new-project",
			name: "New project",
			callback: () => new NewProjectModal(this.app, this).open(),
		});

		this.addCommand({
			id: "new-task",
			name: "New task",
			callback: () => this.promptNewTask(),
		});

		this.addCommand({
			id: "show-projects-leaflet",
			name: "Open project list dock",
			callback: () => void this.openProjectsLeaflet(),
		});

		this.addCommand({
			id: "open-task-column",
			// Obsidian prefixes the plugin name itself, so the palette reads
			// "Project Tracker: Open project tasks dock" from this alone.
			name: "Open project tasks dock",
			callback: () => void this.openTaskColumn(),
		});

		this.addCommand({
			id: "open-projects",
			name: "Open projects list",
			callback: () => void this.openProjectList(),
		});

		this.addCommand({
			id: "open-project",
			name: "Open project…",
			callback: () => {
				const projects = this.store.getProjects();
				if (!projects.length) {
					new Notice("No projects found yet.");
					return;
				}
				new ProjectSuggestModal(this.app, projects, (project) => {
					void this.openProject(project.configFile.path);
				}).open();
			},
		});
	}

	private promptNewTask(): void {
		const project = this.activeProject();
		if (project) {
			new NewTaskModal(this.app, this, project).open();
			return;
		}

		const projects = this.store.getProjects();
		if (!projects.length) {
			new Notice("Create a project before adding tasks.");
			return;
		}
		new ProjectSuggestModal(this.app, projects, (chosen) => {
			new NewTaskModal(this.app, this, chosen).open();
		}).open();
	}

	/** The project implied by what the user is looking at, if any. */
	private activeProject(): Project | null {
		const view = this.app.workspace.getActiveViewOfType(ProjectView);
		const fromBoard = view?.getState().projectPath;
		if (typeof fromBoard === "string") {
			const project = this.store.getProjectByConfigPath(fromBoard);
			if (project) return project;
		}

		const file = this.app.workspace.getActiveFile();
		return file ? this.store.getProjectForFile(file) : null;
	}

	/**
	 * Open a project's board.
	 *
	 * `newTab` forces a tab of its own whatever the setting says — the context
	 * menu's escape hatch, and the reason this takes an option rather than
	 * reading the setting at the call site.
	 */
	async openProject(
		configPath: string,
		options: { newTab?: boolean } = {}
	): Promise<void> {
		const leaf = options.newTab
			? this.app.workspace.getLeaf("tab")
			: this.projectLeaf(configPath);

		await leaf.setViewState({
			type: VIEW_TYPE_PROJECT,
			active: true,
			state: { projectPath: configPath },
		});
		await this.app.workspace.revealLeaf(leaf);
	}

	/** Which leaf a project should open into, given the setting. */
	private projectLeaf(configPath: string): WorkspaceLeaf {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_PROJECT);

		// A leaf already on this project wins wherever it is, and whatever the
		// setting says: opening what is already open should surface it rather
		// than draw it a second time.
		const same = leaves.find(
			(leaf) => (leaf.view as ProjectView).getState().projectPath === configPath
		);
		if (same) return same;

		if (!this.settings.replaceProjectPages) return this.app.workspace.getLeaf("tab");

		// Any project page, but only in the main area. A board someone has pulled
		// into a sidebar to keep beside their work is not a tab to be recycled.
		const reusable = leaves.find(
			(leaf) => leaf.getRoot() === this.app.workspace.rootSplit
		);
		return reusable ?? this.app.workspace.getLeaf("tab");
	}

	async openProjectList(): Promise<void> {
		// Only a leaf in the main area counts as the one to reuse. Without this a
		// docked projects leaflet is found first, and the ribbon icon reveals the
		// sidebar instead of opening the tab it is asking for.
		const existing = this.app.workspace
			.getLeavesOfType(VIEW_TYPE_PROJECT_LIST)
			.find((leaf) => leaf.getRoot() === this.app.workspace.rootSplit);
		const leaf = existing ?? this.app.workspace.getLeaf("tab");
		await leaf.setViewState({ type: VIEW_TYPE_PROJECT_LIST, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	/**
	 * The same projects view, docked.
	 *
	 * Hand-rolled rather than ensureSideLeaf, which treats any leaf of the type as
	 * the one it was asked for — with the projects page open in a tab it decides
	 * there is nothing to do and the sidebar never appears. Only a leaf outside
	 * the main area counts here.
	 *
	 * One only: unlike a task column there is nothing to configure per leaf, so a
	 * second would show the same thing. An existing one is revealed instead.
	 */
	async openProjectsLeaflet(): Promise<void> {
		const existing = this.app.workspace
			.getLeavesOfType(VIEW_TYPE_PROJECT_LIST)
			.find((leaf) => leaf.getRoot() !== this.app.workspace.rootSplit);
		if (existing) {
			await this.app.workspace.revealLeaf(existing);
			return;
		}

		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: VIEW_TYPE_PROJECT_LIST, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	/** Newly created config notes need a metadata-cache pass before they are indexed. */
	async awaitProject(configPath: string, timeoutMs = 4000): Promise<Project | null> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const project = this.store.getProjectByConfigPath(configPath);
			if (project) return project;
			await wait(100);
		}
		return null;
	}

	/**
	 * Gives every task the link to its project's note, and corrects any that has
	 * drifted.
	 *
	 * project-file is derived from project-id, never the other way round, so this
	 * only ever rewrites the link — a task can never change project by having its
	 * link edited. Runs after the first index rather than during it, so it works
	 * from a complete picture and never writes while the store is still reading.
	 * Idempotent: after the first pass there is nothing to write.
	 */
	private async repairProjectLinks(): Promise<void> {
		if (!this.settings.repairProjectLinks) return;

		const projects = new Map(this.store.getProjects().map((project) => [project.id, project]));

		// Deliberately silent, and counting nothing. This runs at startup, so a
		// notice would greet every launch and a console line is logging a plugin
		// ships to every user's console forever. What it did is visible in the
		// notes it repaired.
		for (const task of this.store.getAllTasks()) {
			const project = projects.get(task.projectId);
			// No project indexed for this id: the config note is missing or not
			// tagged. Leaving the link alone says so more usefully than guessing.
			if (!project) continue;
			await repairProjectLink(this.app, project, task);
		}
	}

	/**
	 * A new column each time rather than reusing one: the leaf holds the whole
	 * configuration, so several docked columns are the point. It opens
	 * unconfigured and prompts for a project and status.
	 */
	async openTaskColumn(): Promise<void> {
		const leaf = this.app.workspace.getRightLeaf(true);
		if (!leaf) return;
		await leaf.setViewState({ type: VIEW_TYPE_COLUMN, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	private async runAutoStatusChange(): Promise<void> {
		if (!this.settings.autoStatusChange) return;

		let moved = 0;
		for (const project of this.store.getProjects()) {
			for (const task of this.store.getTasks(project.id)) {
				const status = project.statuses[task.status];
				if (!status?.nextStatus || !project.statuses[status.nextStatus]) continue;

				const duration = parseDuration(status.autoStatusChange);
				if (duration === null) continue;

				const since = parseDate(task.statusModified);
				if (!since || Date.now() - since.getTime() < duration) continue;

				await setTaskStatus(this.app, project, task, status.nextStatus);
				moved++;
			}
		}

		if (moved) {
			new Notice(`Advanced ${moved} task${moved === 1 ? "" : "s"} on schedule.`);
		}
	}

	/**
	 * Known keys only.
	 *
	 * Object.assign copied whatever the file held straight through, so a setting
	 * the plugin had dropped went on living in every vault that had ever written
	 * it — invisible, unreachable, and saved back on the next write.
	 */
	async loadSettings(): Promise<void> {
		const stored = ((await this.loadData()) ?? {}) as Record<string, unknown>;
		const settings = { ...DEFAULT_SETTINGS };

		for (const key of Object.keys(settings)) {
			if (key in stored) Object.assign(settings, { [key]: stored[key] });
		}

		this.settings = settings;
	}

	/** Mirrors store.onChange, for the things the store does not hold. */
	onSettingsChange(listener: () => void): () => void {
		this.settingsListeners.add(listener);
		return () => this.settingsListeners.delete(listener);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		for (const listener of this.settingsListeners) listener();
	}
}
