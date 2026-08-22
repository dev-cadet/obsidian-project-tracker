import { App, SuggestModal } from "obsidian";
import type { Project } from "../types";

export class ProjectSuggestModal extends SuggestModal<Project> {
  constructor(
    app: App,
    private projects: Project[],
    private onChoose: (project: Project) => void,
  ) {
    super(app);
    this.setPlaceholder("Search projects…");
  }

  getSuggestions(query: string): Project[] {
    const needle = query.toLowerCase();
    return this.projects.filter(
      (p) =>
        p.title.toLowerCase().includes(needle) ||
        p.folder.path.toLowerCase().includes(needle),
    );
  }

  renderSuggestion(project: Project, el: HTMLElement): void {
    el.createDiv({ text: project.title });
    el.createEl("small", { cls: "pt-suggest-path", text: project.folder.path });
  }

  onChooseSuggestion(project: Project): void {
    this.onChoose(project);
  }
}
