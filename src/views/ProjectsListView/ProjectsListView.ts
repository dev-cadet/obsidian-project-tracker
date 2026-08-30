import {
	ExtraButtonComponent,
	ItemView,
	Menu,
	Platform,
	WorkspaceLeaf,
	setIcon,
} from "obsidian";
import type ProjectTrackerPlugin from "../../main";
import type { Project } from "../../types";
import { VIEW_TYPE_PROJECT_LIST } from "../../types";
import { NewProjectModal } from "../../modals/NewProjectModal";
import { ProjectConfigModal } from "../../modals/ProjectConfigModal";
import {
	DEFAULT_PROJECT_LIST_CONFIG,
	ProjectListConfigModal,
	type ProjectListConfig,
} from "../../modals/ProjectListConfigModal";
import { Button } from "../../ui/Button";
import { SortableGrid } from "../../ui/SortableGrid";
import { renderProjectCard } from "./Components/ProjectCard";
import { orderProjects } from "./order";

/** Per-leaf, so a docked list and the full page each remember their own. */
export interface ProjectsListViewState {
	showDescription?: boolean;
	showCount?: boolean;
}

export class ProjectsListView extends ItemView {
	private config: ProjectListConfig = { ...DEFAULT_PROJECT_LIST_CONFIG };
	private unsubscribe: (() => void) | null = null;
	private unsubscribeSettings: (() => void) | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: ProjectTrackerPlugin
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_PROJECT_LIST;
	}

	getIcon(): string {
		return "folder-kanban";
	}

	getDisplayText(): string {
		return "Projects";
	}

	getState(): Record<string, unknown> {
		return { ...this.config };
	}

	async setState(
		state: ProjectsListViewState,
		result: { history: boolean }
	): Promise<void> {
		if (typeof state?.showDescription === "boolean") {
			this.config.showDescription = state.showDescription;
		}
		if (typeof state?.showCount === "boolean") this.config.showCount = state.showCount;
		this.render();
		await super.setState(state, result);
	}

	/**
	 * A leaf outside the main area. The dock is a place to open a project from,
	 * not to start one in, so it does not carry the New project button.
	 */
	private get isDocked(): boolean {
		return this.leaf.getRoot() !== this.app.workspace.rootSplit;
	}

	/**
	 * The page on a phone, where the header row is not drawn.
	 *
	 * The app already puts this view's name and a `...` button across the top of
	 * the screen, so a second title under it is the same word twice and the row
	 * it sits on is a row of tiles not shown. The dock is not this: its header is
	 * the only thing naming it, and it keeps one.
	 */
	private get isMobilePage(): boolean {
		return Platform.isMobile && !this.isDocked;
	}

	/**
	 * The `...` button on mobile, and a tab's right-click menu on desktop.
	 *
	 * Everything the header row held on a phone, since the row itself is gone —
	 * the same trade the project page makes, and the same reason: the button that
	 * opens this menu is in the app's header whether the plugin wants it or not,
	 * so a control put here costs nothing.
	 *
	 * Sectioned, because insertion order is not what orders a menu: anything
	 * without a section lands in the unnamed bucket, second from last.
	 */
	onPaneMenu(menu: Menu, source: string): void {
		if (this.isMobilePage) {
			menu.addItem((item) =>
				item
					.setSection("action")
					.setTitle("New project")
					.setIcon("plus")
					.onClick(() => new NewProjectModal(this.app, this.plugin).open())
			);
			menu.addItem((item) =>
				item
					.setSection("action")
					.setTitle("Configure this list")
					.setIcon("sliders-horizontal")
					.onClick(() => this.configure())
			);
			menu.addSeparator();
		}

		super.onPaneMenu(menu, source);
	}

	async onOpen(): Promise<void> {
		this.unsubscribe = this.plugin.store.onChange(() => this.render());

		// The arrangement is dragged on the page and stored in settings, so every
		// other list showing it — the dock, a second page — hears about it here
		// rather than staying on the order it was rendered with.
		this.unsubscribeSettings = this.plugin.onSettingsChange(() => this.render());

		this.render();
	}

	async onClose(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.unsubscribeSettings?.();
		this.unsubscribeSettings = null;
	}

	private render(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("pt-list-view");

		if (!this.isMobilePage) this.renderHeader(root);

		// Same race as the project view: the list is restored before the first
		// scan finishes, so an empty index is not yet an empty vault.
		if (!this.plugin.store.ready) {
			root.createDiv({ cls: "pane-empty", text: "Loading…" });
			return;
		}

		const projects = this.plugin.store.getProjects();
		if (!projects.length) {
			// Obsidian's treatment for an empty pane: centred, faint, small.
			root.createDiv({
				cls: "pane-empty",
				text: "No projects yet. Create one against an empty folder — Project Tracker writes a config note, a Tasks folder and a first task.",
			});
			return;
		}

		// The plugin browser's grid: auto-filled columns, 240px minimum.
		const grid = root.createDiv({ cls: "community-modal-search-results" });
		const display = this.isDocked ? "dock" : "page";

		// Both displays show the arrangement; only the page can change it. A dock
		// listing the same projects in a different order is two answers to the same
		// question, and the page is where the answer was given.
		const shown = orderProjects(projects, this.plugin.settings.projectOrder);

		const sortable = this.isDocked ? null : this.sortable(grid, shown);

		for (const project of shown) {
			const tasks = this.plugin.store.getTasks(project.id);
			const card = renderProjectCard(grid, project, tasks, this.config, display, () => {
				void this.plugin.openProject(project.configFile.path);
			});

			// The whole card is the handle. There is nothing inside it holding a
			// text selection for a draggable ancestor to swallow, and a grip in the
			// corner of every tile is a permanent mark on a page whose point is
			// that it is a clean wall of them.
			sortable?.add(card);

			if (!this.isDocked) this.addCardMenu(card, project);
		}
	}

	/**
	 * Right-click on a card, on the page.
	 *
	 * Both items are things the card cannot say on its own: the click already
	 * means "open", and where it opens is a setting, so the override for a single
	 * project has to live somewhere. Configuration is here for the same reason it
	 * is on the board's own `...` menu — it belongs to the project, not the page.
	 *
	 * Sectioned like the plugin's other menu items, since an unsectioned one
	 * lands in the unnamed bucket rather than where it was added.
	 */
	private addCardMenu(card: HTMLElement, project: Project): void {
		card.addEventListener("contextmenu", (event) => {
			event.preventDefault();

			const menu = new Menu();
			menu.addItem((item) =>
				item
					.setSection("action")
					.setTitle("Open in new tab")
					.setIcon("file-plus")
					.onClick(() => {
						void this.plugin.openProject(project.configFile.path, {
							newTab: true,
						});
					})
			);
			menu.addItem((item) =>
				item
					.setSection("action")
					.setTitle("Project configuration")
					.setIcon(project.icon)
					.onClick(() =>
						new ProjectConfigModal(this.app, this.plugin, project).open()
					)
			);
			menu.showAtMouseEvent(event);
		});
	}

	/**
	 * Saves the whole arrangement, not the pair that moved.
	 *
	 * What is written is the order as it now stands, every project in it — so a
	 * project that had never been dragged stops depending on where the store
	 * happened to sort it, and one dragged later has somewhere to be dragged from.
	 */
	private sortable(grid: HTMLElement, shown: Project[]): SortableGrid {
		// Marks the grid as one whose tiles animate. The dock renders the same
		// cards and never gets it, so nothing there can be caught by a transition
		// meant for a drag it cannot start.
		grid.addClass("pt-sortable");

		return new SortableGrid(grid, (from, to) => {
			const next = [...shown];
			const [moved] = next.splice(from, 1);
			next.splice(to, 0, moved);

			this.plugin.settings.projectOrder = next.map((project) => project.id);
			// No render here: saving is what announces the new arrangement, and this
			// view is listening for that like every other one. The grid is already
			// showing it in the meantime — the drag put it there — and the render
			// that follows is what makes the tiles' indices match it again.
			void this.plugin.saveSettings();
		});
	}

	/** Replaces the app's own header, which would otherwise say this twice. */
	private renderHeader(root: HTMLElement): void {
		const header = root.createDiv({ cls: "pt-list-header" });
		// The page can spend the width on an icon. The dock's leaf tab already
		// carries this view's icon directly above the header, so a second one is
		// the same mark twice.
		if (!this.isDocked) setIcon(header.createSpan(), "folder-kanban");
		header.createEl("h2", { cls: "pt-list-header-title", text: "Projects" });

		if (!this.isDocked) {
			new Button(header, {
				text: "New project",
				variant: "cta",
				onClick: () => new NewProjectModal(this.app, this.plugin).open(),
			});
		}

		if (this.isDocked) {
			// Obsidian's own bare-icon control: .clickable-icon, with tabIndex and
			// Enter/Space handling of its own. No button chrome, so it costs the
			// width of the icon rather than a button's padding either side of it.
			new ExtraButtonComponent(header)
				.setIcon("sliders-horizontal")
				.setTooltip("Configure this list")
				.onClick(() => this.configure());
		} else {
			new Button(header, {
				icon: "sliders-horizontal",
				tooltip: "Configure this list",
				class: "pt-btn-style-flat",
				onClick: () => this.configure(),
			});
		}
	}

	private configure(): void {
		new ProjectListConfigModal(this.app, this.config, (value) => {
			this.config = value;
			this.app.workspace.requestSaveLayout();
			this.render();
		}).open();
	}
}
