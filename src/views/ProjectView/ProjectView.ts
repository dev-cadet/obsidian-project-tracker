import { ItemView, Notice, Platform, WorkspaceLeaf, setIcon } from "obsidian";
import type { Menu, MenuItem } from "obsidian";
import type ProjectTrackerPlugin from "../../main";
import type { GroupBy, Project, SavedView, SortField } from "../../types";
import { VIEW_TYPE_PROJECT } from "../../types";
import { writeBoardConfig } from "../../io/projectFile";
import { setTaskStatus } from "../../io/taskFile";
import { boardColumns, filterTasks, sortTasks } from "../../store/query";
import { DEFAULT_PROJECT_ICON } from "../../util/defaults";
import { renamedPath } from "../../util/paths";
import { EditViewModal } from "../../modals/EditViewModal";
import { NewTaskModal } from "../../modals/NewTaskModal";
import { TaskEditModal } from "../../modals/TaskEditModal";
import { ProjectConfigModal } from "../../modals/ProjectConfigModal";
import { Button } from "../../ui/Button";
import { renderBoard, type ColumnCycle } from "./Components/BoardRenderer";
import { renderTable } from "./Components/TableRenderer";
import { COLUMN_HEADERS, COLUMN_SORT, normalizeColumns } from "./columnMeta";
import { renderProjectHeader } from "./Components/ProjectHeader";
import { renderProjectToolbar } from "./Components/ProjectToolbar";

/**
 * The board's columns, as something a menu can list.
 *
 * Labels rather than statuses: whatever renders it needs to know what to call
 * each one and what to hand back when one is picked, and nothing more.
 */
interface ColumnPicker {
	options: { key: string; label: string }[];
	selected: string;
	onSelect: (key: string) => void;
}
import { showTaskMenu } from "../shared/taskMenu";
import type { TaskHost } from "./TaskHost";

interface ProjectViewState {
	projectPath?: string;
	activeViewId?: string;
}

export class ProjectView extends ItemView {
	private projectPath: string | null = null;
	private activeViewId: string | null = null;
	private search = "";
	/** Which board column is on screen where only one is. Null means the first. */
	private boardColumn: string | null = null;
	/** Last name written to the leaf header, so it is only repainted on a change. */
	private headerText: string | null = null;
	private collapsedGroups = new Set<string>();
	private bodyEl: HTMLElement | null = null;
	private footerEl: HTMLElement | null = null;
	private unsubscribe: (() => void) | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: ProjectTrackerPlugin
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_PROJECT;
	}

	getIcon(): string {
		return this.currentProject()?.icon ?? DEFAULT_PROJECT_ICON;
	}

	getDisplayText(): string {
		return this.currentProject()?.title ?? "Project";
	}

	/**
	 * The `...` button on mobile, and a tab's right-click menu on desktop.
	 *
	 * On mobile this is the toolbar. Every control that row held is here instead,
	 * because the row itself is worth more as two more tasks on screen — and the
	 * button that opens this menu is already in the header whether the plugin
	 * wants it or not.
	 *
	 * Every item is put in the "action" section. Insertion order is not what
	 * orders a menu: `Menu.addSections` declares the order, and anything with no
	 * section of its own lands in the unnamed bucket, which sits second from last
	 * — so adding these first put them at the bottom rather than the top.
	 */
	onPaneMenu(menu: Menu, source: string): void {
		const project = this.currentProject();
		if (!project) {
			super.onPaneMenu(menu, source);
			return;
		}

		const view = this.currentView(project);

		if (Platform.isMobile) {
			// The column header's add button is gone on a phone, so this is the only
			// route left — and it starts in the column being looked at rather than
			// in whichever status happens to be first.
			const column = view.type === "kanban" ? this.boardVisible(project, view)[0] : undefined;
			menu.addItem((item) =>
				item
					.setSection("action")
					.setTitle("New task")
					.setIcon("plus")
					.onClick(() => this.host(project).createTask(column))
			);
			menu.addItem((item) =>
				item
					.setSection("action")
					.setTitle(`Configure "${view.name}"`)
					.setIcon("sliders-horizontal")
					.onClick(() => this.openViewEditor(project, view))
			);

			const picker = this.columnPicker(project, view);
			if (picker) this.addColumnMenu(menu, picker);

			// A phone draws a table as cards, which have no column headers to sort by
			// and leave no room for the Group dropdown, so both live here instead.
			// Only on a phone: a tablet still gets the table itself, and with it both
			// controls where they have always been.
			if (view.type === "table" && Platform.isPhone) {
				this.addSortMenu(menu, project, view);
				this.addGroupMenu(menu, project, view);
			}

			menu.addSeparator();
		}

		menu.addItem((item) =>
			item
				// The icon the heading's configuration button used to carry, which
				// on mobile is not drawn at all.
				.setSection("action")
				.setTitle("Project configuration")
				.setIcon(project.icon)
				.onClick(() => new ProjectConfigModal(this.app, this.plugin, project).open())
		);

		super.onPaneMenu(menu, source);
	}

	/**
	 * The board's columns, nested under one item so a project with eight statuses
	 * does not push everything else off the menu.
	 *
	 * `setSubmenu` is not in the public typings, so it is reached through a
	 * widened type. Where it is missing the columns are listed flat under the same
	 * title, left as a label — longer, but every column still reachable, which is
	 * the part that matters.
	 */
	private addColumnMenu(menu: Menu, picker: ColumnPicker): void {
		const nested = this.submenuFor(menu, "Column", "columns-3");
		const rows: { key: string; item: MenuItem }[] = [];

		/**
		 * The tick is the item's own icon rather than setChecked.
		 *
		 * A phone submenu stays open after a tap, so nothing rebuilds these marks
		 * until the menu is reopened and they have to be moved by hand — and
		 * setChecked cannot be driven that way. Clearing it detaches its tick but
		 * keeps the reference, so checking the same item again short-circuits on
		 * that reference and never puts the tick back. setIcon empties and refills
		 * one element, which survives being toggled either way.
		 *
		 * Clearing it to null leaves the empty icon element in place, so the
		 * unticked titles stay lined up with the ticked one.
		 */
		const mark = (selected: string): void => {
			for (const row of rows) {
				row.item.setIcon(row.key === selected ? "lucide-check" : null);
			}
		};

		for (const option of picker.options) {
			(nested ?? menu).addItem((item) => {
				rows.push({ key: option.key, item });
				item.setTitle(option.label).onClick(() => {
					picker.onSelect(option.key);
					mark(option.key);
				});
			});
		}

		mark(picker.selected);
	}

	/**
	 * Sorting, for the display that has no column headers to click.
	 *
	 * The columns the view shows, which is exactly what the table's own headers
	 * offer — a column that is not on screen is not something to order by. The
	 * arrow doubles as the mark: it names the direction and identifies the sorted
	 * column at once, the same job the header's arrow does.
	 *
	 * The header cycles unsorted → ascending → descending → unsorted. Here the
	 * active column flips between the two directions and "None" clears it, because
	 * a menu can show the third state as an item of its own rather than hiding it
	 * in a third tap.
	 */
	private addSortMenu(menu: Menu, project: Project, view: SavedView): void {
		const nested = this.submenuFor(menu, "Sort", "arrow-up-down");
		const rows: { field: SortField | null; item: MenuItem }[] = [];

		// The menu outlives the render that follows a tap, so the state it shows is
		// tracked here and moved by hand — see addColumnMenu for why the mark is an
		// icon rather than setChecked.
		let field = view.sort.field;
		let dir = view.sort.dir;

		const mark = (): void => {
			for (const row of rows) {
				if (row.field !== field) {
					row.item.setIcon(null);
				} else {
					row.item.setIcon(
						field === null ? "lucide-check" : dir === "asc" ? "arrow-up" : "arrow-down"
					);
				}
			}
		};

		const add = (title: string, target: SortField | null): void => {
			(nested ?? menu).addItem((item) => {
				rows.push({ field: target, item });
				item.setTitle(title).onClick(() => {
					// Tapping the column already sorted turns it round; tapping any
					// other starts it ascending, which is what the header does too.
					dir = target !== null && target === field && dir === "asc" ? "desc" : "asc";
					field = target;
					this.host(project).setSort(target, dir);
					mark();
				});
			});
		};

		add("None", null);
		for (const column of normalizeColumns(view.columns)) {
			add(COLUMN_HEADERS[column], COLUMN_SORT[column]);
		}

		mark();
	}

	/** The toolbar's Group dropdown, on the display that has no room for a row. */
	private addGroupMenu(menu: Menu, project: Project, view: SavedView): void {
		const nested = this.submenuFor(menu, "Group", "list-tree");
		const rows: { key: GroupBy; item: MenuItem }[] = [];

		const mark = (selected: GroupBy): void => {
			for (const row of rows) {
				row.item.setIcon(row.key === selected ? "lucide-check" : null);
			}
		};

		const options: { key: GroupBy; label: string }[] = [
			{ key: "none", label: "None" },
			{ key: "status", label: "Status" },
			{ key: "label", label: "Label" },
		];

		for (const option of options) {
			(nested ?? menu).addItem((item) => {
				rows.push({ key: option.key, item });
				item.setTitle(option.label).onClick(() => {
					// currentView rather than the captured view: the menu stays open
					// across taps, and this writes the whole view back.
					void this.saveView(project, {
						...this.currentView(project),
						groupBy: option.key,
					});
					mark(option.key);
				});
			});
		}

		mark(view.groupBy);
	}

	private submenuFor(menu: Menu, title: string, icon: string): Menu | null {
		let nested: Menu | null = null;

		menu.addItem((item) => {
			item.setSection("action").setTitle(title).setIcon(icon);
			try {
				nested = (item as MenuItem & { setSubmenu?: () => Menu }).setSubmenu?.() ?? null;
			} catch {
				nested = null;
			}
			// Nothing behind it, so it heads the flat list instead of looking like
			// an item that does nothing when tapped.
			if (nested === null) item.setIsLabel(true);
		});

		return nested;
	}

	getState(): Record<string, unknown> {
		return { projectPath: this.projectPath, activeViewId: this.activeViewId };
	}

	async setState(state: ProjectViewState, result: { history: boolean }): Promise<void> {
		if (state?.projectPath) this.projectPath = state.projectPath;
		if (state?.activeViewId) this.activeViewId = state.activeViewId;
		this.renderShell();
		await super.setState(state, result);
	}

	async onOpen(): Promise<void> {
		this.unsubscribe = this.plugin.store.onChange(() => this.renderShell());

		// The leaf is addressed by its config note's path, so anything that moves
		// that note — renaming it, renaming a folder anywhere above it, dragging
		// the project somewhere else — leaves this pointing at a path nothing is
		// at, and the view reports the project missing.
		//
		// Prefix-matched, not compared: renaming a project's parent folder never
		// names the config note, and matching only the note's own event is why
		// this went on failing after it was first wired up.
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				const moved = renamedPath(this.projectPath, oldPath, file.path);
				if (!moved) return;
				this.projectPath = moved;

				// The path is half of what getState persists, and the layout on disk
				// still holds the old one until this is asked for.
				this.app.workspace.requestSaveLayout();

				// Only if the store has already caught up. It re-reads on its own
				// settled tick and notifies when it does, and rendering before then
				// would show the not-found screen in the meantime.
				if (this.currentProject()) this.renderShell();
			})
		);

		this.renderShell();
	}

	async onClose(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	private currentProject(): Project | null {
		if (!this.projectPath) return null;
		return this.plugin.store.getProjectByConfigPath(this.projectPath);
	}

	private currentView(project: Project): SavedView {
		const byId = project.board.views.find((v) => v.id === this.activeViewId);
		if (byId) return byId;
		const fallback =
			project.board.views.find((v) => v.id === project.board.defaultView) ??
			project.board.views[0];
		this.activeViewId = fallback?.id ?? null;
		return fallback;
	}

	/**
	 * Repaint the leaf's own header, so the tab and — on mobile, where it is the
	 * only thing naming the project — the title bar show the project rather than
	 * the fallback.
	 *
	 * Obsidian reads getDisplayText once, in View.load(). On startup that happens
	 * before the store has indexed the vault, so the name resolves to the "Project"
	 * fallback and nothing ever asks again.
	 *
	 * Two elements, because they are two copies of the name and only one of them
	 * is on screen at a time:
	 *
	 * - titleEl is .view-header-title, the header bar's own title. It is the whole
	 *   of the header on mobile, and it is the one View.load() writes once.
	 *   Obsidian's FileView sets it by hand on rename for exactly this reason.
	 * - leaf.updateHeader() repaints the tab strip's copy, which is what shows on
	 *   desktop and does not exist on mobile.
	 *
	 * Neither is in the public typings, so both go through a widened type inside
	 * one try: if a future version drops either, the header keeps whatever name it
	 * already had, which is the behaviour without this method at all.
	 *
	 * Guarded on the text changing, so a store change per keystroke elsewhere does
	 * not repaint a name that has not moved.
	 */
	private refreshHeader(): void {
		const text = this.getDisplayText();
		if (text === this.headerText) return;
		this.headerText = text;

		try {
			(this as ProjectView & { titleEl?: HTMLElement }).titleEl?.setText(text);
			(this.leaf as WorkspaceLeaf & { updateHeader?: () => void }).updateHeader?.();
		} catch {
			// Nothing to do: the header simply keeps the name it was given.
		}
	}

	private renderShell(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("pt-project-page");
		this.refreshHeader();

		const project = this.currentProject();
		if (!project) {
			this.renderMissing(root);
			return;
		}

		// Everything on the page that is keyed to the project's colour reads this
		// rather than being handed the value: the tab strip today, whatever else
		// later. An empty colour removes the property, which drops the page back to
		// the default declared in the stylesheet.
		root.style.setProperty("--pt-project-color", project.color);

		const view = this.currentView(project);

		renderProjectHeader(
			root,
			project,
			view,
			{
				onConfigure: () => new ProjectConfigModal(this.app, this.plugin, project).open(),
				onSelectView: (saved) => {
					this.activeViewId = saved.id;
					// Each view has its own columns, so a column picked in one means
					// nothing in the next.
					this.boardColumn = null;
					this.collapsedGroups.clear();
					this.app.workspace.requestSaveLayout();
					this.renderShell();
				},
				onNewView: () => this.openViewEditor(project, null),
			},
			// The app's own header is showing on mobile and already names the view,
			// so the plugin's title row would be the second one saying it.
			!Platform.isMobile
		);

		renderProjectToolbar(
			root,
			view,
			this.search,
			{
				onSearch: (value) => {
					this.search = value;
					this.renderBody();
				},
				onConfigure: () => this.openViewEditor(project, view),
				onChangeView: (next) => void this.saveView(project, next),
				onNewTask: () => this.host(project).createTask(),
			},
			{
				// The pane menu carries these on mobile, and a row that would hold
				// nothing is a row of screen spent on nothing.
				//
				// A phone board gives the search box's place to the column picker, so
				// it loses it. A table has no picker and nothing else to narrow it
				// with, so it keeps the box and gets the whole row for it.
				search: !Platform.isPhone || view.type === "table",
				group: !Platform.isPhone,
				actions: !Platform.isMobile,
			}
		);

		if (project.configErrors.length) this.renderConfigErrors(root, project);

		// Body scrolls; the footer note sits outside it so it never adds to the
		// scroll height.
		this.bodyEl = root.createDiv({ cls: "pt-project-page-body" });
		this.footerEl = root.createDiv({ cls: "pt-project-page-footer" });
		this.renderBody();
	}

	/**
	 * The columns a board draws. One on a phone, where a row of them does not fit
	 * and panning sideways to find a status is worse than naming the one wanted.
	 *
	 * isPhone rather than isMobile: isMobile is true on a tablet too, and a tablet
	 * has the width for the whole board. Obsidian draws the same line — it hides
	 * the mobile navbar on tablets for the same reason.
	 */
	private boardVisible(project: Project, view: SavedView): string[] {
		const visible = boardColumns(project.statusOrder, view.filters.status);
		if (!Platform.isPhone || !visible.length) return visible;

		// Falls back rather than failing: the column being shown can leave the
		// board without anything asking it to — the view's status filter changed,
		// or the status was renamed in config.
		const selected =
			this.boardColumn && visible.includes(this.boardColumn)
				? this.boardColumn
				: visible[0];
		return [selected];
	}

	/**
	 * Stepping between board columns, on the display that shows one at a time.
	 *
	 * Null anywhere the whole board is on screen: there is nothing to step to, and
	 * the header spends the room on its add button instead.
	 */
	private columnCycle(project: Project, view: SavedView): ColumnCycle | null {
		if (view.type !== "kanban" || !Platform.isPhone) return null;

		const visible = boardColumns(project.statusOrder, view.filters.status);
		const index = visible.indexOf(this.boardVisible(project, view)[0]);
		if (index === -1) return null;

		return {
			previous: index > 0 ? visible[index - 1] : null,
			next: index < visible.length - 1 ? visible[index + 1] : null,
			onSelect: (key) => {
				this.boardColumn = key;
				this.renderBody();
			},
		};
	}

	/**
	 * The control that stands in for the search box on a phone.
	 *
	 * Null on a table, a tablet and a desktop: only a board has columns, and only
	 * a phone is short of the room to show them side by side.
	 *
	 * Counts come off the view's filters rather than the search box, matching the
	 * footer note — and on mobile there is no search box to disagree with anyway.
	 */
	private columnPicker(project: Project, view: SavedView): ColumnPicker | null {
		if (view.type !== "kanban" || !Platform.isPhone) return null;

		const visible = boardColumns(project.statusOrder, view.filters.status);
		if (!visible.length) return null;

		const tasks = filterTasks(this.plugin.store.getTasks(project.id), view.filters);
		return {
			options: visible.map((key) => ({
				key,
				label: `${project.statuses[key]?.name ?? key} (${
					tasks.filter((task) => task.status === key).length
				})`,
			})),
			selected: this.boardVisible(project, view)[0],
			onSelect: (key) => {
				this.boardColumn = key;
				this.renderBody();
			},
		};
	}

	private renderMissing(root: HTMLElement): void {
		// The index is built after the layout is restored, so until the first scan
		// finishes an absent project means "not looked yet", not "not there".
		if (!this.plugin.store.ready) {
			root.createDiv({ cls: "pane-empty", text: "Loading…" });
			return;
		}

		const empty = root.createDiv({ cls: "pt-project-page-empty" });
		empty.createDiv({
			cls: "pane-empty",
			text: this.projectPath
				? `Could not find a project config at ${this.projectPath}. It may have been renamed or its ProjectConfig tag removed.`
				: "Open a project from the Projects list to get started.",
		});
		new Button(empty, {
			text: "Browse projects",
			variant: "cta",
			onClick: () => void this.plugin.openProjectList(),
		});
	}

	private renderConfigErrors(root: HTMLElement, project: Project): void {
		const warning = root.createDiv({ cls: "pt-project-page-warning" });
		setIcon(warning.createSpan({ cls: "pt-project-page-warning-icon" }), "alert-triangle");

		const text = warning.createDiv();
		for (const message of project.configErrors) text.createDiv({ text: message });

		const open = text.createEl("a", { cls: "pt-project-page-warning-link", text: "Open the config note" });
		open.addEventListener("click", () => {
			void this.app.workspace.getLeaf(false).openFile(project.configFile);
		});
	}

	private renderBody(): void {
		const body = this.bodyEl;
		const footer = this.footerEl;
		const project = this.currentProject();
		if (!body || !footer || !project) return;

		body.empty();
		footer.empty();

		const view = this.currentView(project);
		const host = this.host(project);
		const all = this.plugin.store.getTasks(project.id);
		const matching = filterTasks(all, view.filters);
		const tasks = sortTasks(
			filterTasks(all, view.filters, this.search),
			view.sort,
			project.statusOrder
		);

		const isBoard = view.type === "kanban";
		// Platform rather than a media query: this changes what gets built, not
		// just how it looks, and Obsidian sets the flag for its own mobile mode as
		// well as for a real phone.
		const single = isBoard && Platform.isPhone;

		body.toggleClass("is-board", isBoard);
		body.toggleClass("is-table", !isBoard);
		body.toggleClass("is-single", single);

		if (isBoard) {
			renderBoard(
				body,
				project,
				tasks,
				this.boardVisible(project, view),
				host,
				view.showDescription,
				this.columnCycle(project, view)
			);
		} else {
			renderTable(body, project, tasks, view, host);
		}

		// Counted against the view's filters, not the search box, so the note
		// reflects the view itself rather than what you happen to be typing.
		const hidden = all.length - matching.length;
		footer.toggleClass("is-hidden", hidden === 0);
		if (hidden > 0) {
			footer.setText(
				hidden === 1
					? "1 task is hidden by these filters."
					: `${hidden} tasks are hidden by these filters.`
			);
		}
	}

	private host(project: Project): TaskHost {
		return {
			project,
			collapsedGroups: this.collapsedGroups,
			resolveTask: (path) => this.plugin.store.getTaskByPath(path),
			openTask: (task, newLeaf) => {
				void this.app.workspace.getLeaf(newLeaf).openFile(task.file);
			},
			editTask: (task) => {
				new TaskEditModal(this.plugin, project, task).open();
			},
			showTaskMenu: (event, task) => showTaskMenu(this.plugin, event, project, task),
			moveTask: (task, statusKey) => {
				void setTaskStatus(this.app, project, task, statusKey);
			},
			createTask: (statusKey) => {
				new NewTaskModal(this.app, this.plugin, project, statusKey).open();
			},
			setSort: (field, dir) => {
				void this.saveView(project, { ...this.currentView(project), sort: { field, dir } });
			},
			toggleGroup: (key) => {
				if (this.collapsedGroups.has(key)) this.collapsedGroups.delete(key);
				else this.collapsedGroups.add(key);
				this.renderBody();
			},
		};
	}

	private openViewEditor(project: Project, existing: SavedView | null): void {
		const canDelete = existing !== null && project.board.views.length > 1;
		new EditViewModal(
			this.app,
			project,
			existing,
			(view) => void this.saveView(project, view),
			canDelete ? () => void this.deleteView(project, existing.id) : null
		).open();
	}

	private async saveView(project: Project, view: SavedView): Promise<void> {
		const views = [...project.board.views];
		const index = views.findIndex((v) => v.id === view.id);
		if (index === -1) views.push(view);
		else views[index] = view;

		this.activeViewId = view.id;
		await this.persist(project, { ...project.board, views });
	}

	private async deleteView(project: Project, viewId: string): Promise<void> {
		const views = project.board.views.filter((v) => v.id !== viewId);
		if (!views.length) return;
		if (this.activeViewId === viewId) this.activeViewId = views[0].id;
		await this.persist(project, {
			...project.board,
			defaultView:
				project.board.defaultView === viewId ? views[0].id : project.board.defaultView,
			views,
		});
	}

	private async persist(project: Project, board: Project["board"]): Promise<void> {
		try {
			await writeBoardConfig(this.app, project, board);
			this.app.workspace.requestSaveLayout();
		} catch (error) {
			console.error("Project Tracker: failed to save the board config", error);
			new Notice("Could not save the view — see the console for details.");
		}
	}
}
