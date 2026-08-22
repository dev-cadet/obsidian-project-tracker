import { ExtraButtonComponent, ItemView, WorkspaceLeaf } from "obsidian";
import type ProjectTrackerPlugin from "../../main";
import type { Project, SavedView, StatusOption } from "../../types";
import { VIEW_TYPE_COLUMN } from "../../types";
import { sortTasks } from "../../store/query";
import { DEFAULT_PROJECT_ICON } from "../../util/defaults";
import { TaskEditModal } from "../../modals/TaskEditModal";
import { ColumnConfigModal } from "../../modals/ColumnConfigModal";
import { Button } from "../../ui/Button";
import { renderTaskCard, type TaskActions } from "../shared/TaskCard";
import { showTaskMenu } from "../shared/taskMenu";

/**
 * Everything this view is, and all of it lives in the leaf.
 *
 * Obsidian persists what getState returns into workspace.json per leaf, so two
 * docked columns can show two different things and each remembers its own. The
 * project is held by id rather than by path: the app does not rewrite custom
 * view state when a note is renamed, and a docked column outlives the tabs that
 * would simply have been reopened.
 */
export interface ColumnViewState {
	projectId?: string;
	statusKey?: string;
	showDescription?: boolean;
	showExtras?: boolean;
}

/** Newest first, the order a fresh view starts in everywhere else. */
const SORT: SavedView["sort"] = { field: "task-created", dir: "desc" };

/**
 * One status of one project, as a list of cards.
 *
 * Built for a sidebar: no filters, no sorting, no dragging. A card opens the
 * task editor, and the only control is the button that reconfigures the leaf.
 */
export class ColumnView extends ItemView {
	private projectId: string | null = null;
	private statusKey: string | null = null;
	private showDescription = false;
	private showExtras = true;
	private unsubscribe: (() => void) | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: ProjectTrackerPlugin
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_COLUMN;
	}

	getIcon(): string {
		return this.currentProject()?.icon ?? DEFAULT_PROJECT_ICON;
	}

	getDisplayText(): string {
		return this.currentStatus()?.name ?? "Task column";
	}

	getState(): Record<string, unknown> {
		return {
			projectId: this.projectId,
			statusKey: this.statusKey,
			showDescription: this.showDescription,
			showExtras: this.showExtras,
		};
	}

	async setState(state: ColumnViewState, result: { history: boolean }): Promise<void> {
		if (state?.projectId) this.projectId = state.projectId;
		if (state?.statusKey) this.statusKey = state.statusKey;
		if (typeof state?.showDescription === "boolean") this.showDescription = state.showDescription;
		if (typeof state?.showExtras === "boolean") this.showExtras = state.showExtras;
		this.render();
		await super.setState(state, result);
	}

	async onOpen(): Promise<void> {
		this.unsubscribe = this.plugin.store.onChange(() => this.render());
		this.render();
	}

	async onClose(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	private currentProject(): Project | null {
		return this.projectId ? this.plugin.store.getProjectById(this.projectId) : null;
	}

	private currentStatus(): StatusOption | null {
		const project = this.currentProject();
		if (!project || !this.statusKey) return null;
		return project.statuses[this.statusKey] ?? null;
	}

	private render(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("pt-column-view");

		// The store indexes on layout ready, after leaves are restored. Without
		// this a configured column reads as unconfigured for a moment.
		if (!this.plugin.store.ready) return;

		const project = this.currentProject();
		const status = this.currentStatus();

		if (!project || !status) {
			this.renderHeader(null, null, null);
			this.renderUnset(root, project);
			return;
		}

		const tasks = sortTasks(
			this.plugin.store.getTasks(project.id).filter((task) => task.status === this.statusKey),
			SORT,
			project.statusOrder
		);

		this.renderHeader(project, status, tasks.length);

		const body = root.createDiv({ cls: "pt-column-view-body" });
		if (!tasks.length) {
			body.createDiv({ cls: "pane-empty", text: "Nothing here" });
			return;
		}

		const actions = this.actions(project);
		for (const task of tasks) {
			renderTaskCard(body, project, task, actions, {
				showDescription: this.showDescription,
				showExtras: this.showExtras,
				display: "dock",
			});
		}
	}

	private renderHeader(
		project: Project | null,
		status: StatusOption | null,
		count: number | null
	): void {
		const header = this.contentEl.createDiv({ cls: "pt-column-view-header" });

		const heading = header.createDiv({ cls: "pt-column-view-heading" });
		if (status) {
			const dot = heading.createSpan({ cls: "pt-status-dot" });
			dot.style.setProperty("--pt-status-color", status.color);
		}
		heading.createSpan({
			cls: "pt-column-view-name",
			text: status?.name ?? "Not configured",
		});
		if (count !== null) {
			heading.createSpan({ cls: "pt-column-view-count", text: String(count) });
		}

		// Obsidian's own bare-icon control: .clickable-icon, with tabIndex and
		// Enter/Space handling of its own. No button chrome, so it costs the width
		// of the icon rather than a button's padding either side of it.
		new ExtraButtonComponent(heading)
			.setIcon("sliders-horizontal")
			.setTooltip("Configure this column")
			.onClick(() => this.configure());

		if (project) {
			header.createDiv({ cls: "pt-column-view-project", text: project.title });
		}
	}

	/**
	 * What is shown before a project and status have been picked, and when the
	 * ones that were picked have since gone.
	 */
	private renderUnset(root: HTMLElement, project: Project | null): void {
		let message = "Choose a project and a status to show here.";
		if (this.projectId && !project) message = "That project is no longer in the vault.";
		else if (project && this.statusKey) {
			message = "That status is no longer in this project's config.";
		}

		const empty = root.createDiv({ cls: "pane-empty pt-column-view-unset" });
		empty.createDiv({ text: message });
		new Button(empty, {
			text: "Configure",
			variant: "cta",
			onClick: () => this.configure(),
		});
	}

	private configure(): void {
		new ColumnConfigModal(
			this.app,
			this.plugin.store.getProjects(),
			{
				projectId: this.projectId,
				statusKey: this.statusKey,
				showDescription: this.showDescription,
				showExtras: this.showExtras,
			},
			(value) => {
				this.projectId = value.projectId;
				this.statusKey = value.statusKey;
				this.showDescription = value.showDescription;
				this.showExtras = value.showExtras;
				// Through setViewState rather than render alone: the tab's title
				// and icon are read from the state, so the leaf has to be told it
				// changed for the header to follow.
				void this.leaf.setViewState({ type: VIEW_TYPE_COLUMN, state: this.getState() });
				this.app.workspace.requestSaveLayout();
				// Explicitly, rather than relying on setViewState to call setState:
				// setState guards each field against being overwritten with nothing,
				// which is what Clear hands it.
				this.render();
			}
		).open();
	}

	private actions(project: Project): TaskActions {
		return {
			resolveTask: (path) => this.plugin.store.getTaskByPath(path),
			openTask: (task, newLeaf) => {
				void this.app.workspace.getLeaf(newLeaf).openFile(task.file);
			},
			editTask: (task) => {
				new TaskEditModal(this.plugin, project, task).open();
			},
			showTaskMenu: (event, task) => showTaskMenu(this.plugin, event, project, task),
		};
	}
}
