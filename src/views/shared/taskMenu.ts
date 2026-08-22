import { Menu } from "obsidian";
import type ProjectTrackerPlugin from "../../main";
import type { Project, Task } from "../../types";
import { nextStatusOf, setTaskPrioritized, setTaskStatus } from "../../io/taskFile";
import { TaskEditModal } from "../../modals/TaskEditModal";

/**
 * The context menu for a task, wherever the task is shown.
 *
 * Shared rather than reimplemented per surface: the actions available on a task
 * are a property of the task, not of the thing listing it, and a menu that is
 * shorter on one surface than another is a difference nobody chose.
 *
 * The status moves need the project rather than the store, so a caller that has
 * a task has everything this needs.
 */
export function showTaskMenu(
	plugin: ProjectTrackerPlugin,
	event: MouseEvent,
	project: Project,
	task: Task
): void {
	const { app } = plugin;
	const menu = new Menu();

	menu.addItem((item) =>
		item
			.setTitle("Edit task…")
			.setIcon("pencil")
			.onClick(() => new TaskEditModal(plugin, project, task).open())
	);
	menu.addSeparator();

	menu.addItem((item) =>
		item
			.setTitle("Open note")
			.setIcon("file-text")
			.onClick(() => void app.workspace.getLeaf(false).openFile(task.file))
	);
	menu.addItem((item) =>
		item
			.setTitle("Open in new tab")
			.setIcon("file-plus")
			.onClick(() => void app.workspace.getLeaf(true).openFile(task.file))
	);

	const next = nextStatusOf(project, task);
	if (next) {
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(`Advance to ${next.option.name}`)
				.setIcon("arrow-right")
				.onClick(() => void setTaskStatus(app, project, task, next.key))
		);
	}

	menu.addSeparator();
	for (const key of project.statusOrder) {
		if (key === task.status) continue;
		menu.addItem((item) =>
			item
				.setTitle(`Move to ${project.statuses[key].name}`)
				.onClick(() => void setTaskStatus(app, project, task, key))
		);
	}

	menu.addSeparator();
	menu.addItem((item) =>
		item
			.setTitle(task.prioritized ? "Remove priority" : "Mark as prioritized")
			.setIcon("flame")
			.onClick(() => void setTaskPrioritized(app, task, !task.prioritized))
	);
	menu.addItem((item) =>
		item
			.setTitle("Delete task")
			.setIcon("trash")
			.onClick(() => void app.fileManager.trashFile(task.file))
	);

	menu.showAtMouseEvent(event);
}
