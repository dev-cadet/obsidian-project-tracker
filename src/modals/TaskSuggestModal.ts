import { SuggestModal } from "obsidian";
import type { App } from "obsidian";
import type { Task } from "../types";

/** Search a list of tasks and pick one. Used to assign a parent. */
export class TaskSuggestModal extends SuggestModal<Task> {
  constructor(
    app: App,
    private tasks: Task[],
    private onChoose: (task: Task) => void,
  ) {
    super(app);
    this.setPlaceholder("Search tasks…");
  }

  getSuggestions(query: string): Task[] {
    const needle = query.toLowerCase();
    return this.tasks.filter((task) => task.name.toLowerCase().includes(needle));
  }

  renderSuggestion(task: Task, el: HTMLElement): void {
    el.createDiv({ text: task.name });
    el.createEl("small", { cls: "pt-suggest-path", text: task.file.path });
  }

  onChooseSuggestion(task: Task): void {
    this.onChoose(task);
  }
}
