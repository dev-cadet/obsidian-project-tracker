import { App, Notice, SettingGroup, TFolder, normalizePath } from "obsidian";
import type ProjectTrackerPlugin from "../main";
import type { Project } from "../types";
import { createProject } from "../io/projectFile";
import { createTask } from "../io/taskFile";
import { templateStatuses } from "../settings";
import { sanitizeFileName } from "../util/slug";
import { DEFAULT_PROJECT_COLOR, DEFAULT_PROJECT_ICON } from "../util/defaults";
import { FolderSuggest } from "../util/FolderSuggest";
import { Button } from "../ui/Button";
import { PluginModal } from "../ui/PluginModal";
import { stacked } from "../ui/settingRow";
import { renderColorDot } from "./colorPicker";
import { renderIconButton } from "./IconPickerModal";

export class NewProjectModal extends PluginModal {
  private name = "";
  private description = "";
  private color = DEFAULT_PROJECT_COLOR;
  private icon = DEFAULT_PROJECT_ICON;
  private folderPath = "";
  private folderEdited = false;
  private statusEl!: HTMLElement;
  private createButton!: Button;

  constructor(
    app: App,
    private plugin: ProjectTrackerPlugin,
  ) {
    super(app, { header: "New Project" });
  }

  onOpen(): void {
    let folderInput: HTMLInputElement | null = null;

    // Obsidian builds the group: .setting-group, its heading and .setting-items
    // are all the app's own.
    new SettingGroup(this.content)
      .setHeading("General")
      .addSetting((setting) => {
        stacked(setting)
          .setName("Project name")
          .addText((text) => {
            text.setPlaceholder("New project").onChange((value) => {
              this.name = value;
              if (!this.folderEdited && folderInput) {
                this.folderPath = this.suggestedFolder(value);
                folderInput.value = this.folderPath;
              }
              this.validate();
            });
            this.focusOnOpen(text.inputEl);
          });
        renderIconButton(this.app, setting.controlEl, this.icon, (icon) => {
          this.icon = icon;
        });
      })
      .addSetting((setting) => {
        setting
          .setName("Project colour")
          .setDesc(
            "Used for the project's icon and card accent. Changeable later from the board.",
          );
        renderColorDot(setting.controlEl, this.color, (value) => {
          this.color = value;
        });
      })
      .addSetting((setting) => {
        stacked(setting)
          .setName("Description")
          .addTextArea((text) =>
            text
              .setPlaceholder("What is this project for?")
              .onChange((value) => {
                this.description = value;
              }),
          );
      });

    new SettingGroup(this.content)
      .setHeading("Location")
      .addSetting((setting) => {
        stacked(setting)
          .setName("Folder")
          .setDesc(
            "Must be empty. It will be created if it does not exist yet.",
          )
          .addText((text) => {
            folderInput = text.inputEl;
            // Trips ui/sentence-case, which reads this as one sentence and wants
            // "Projects/new project". The part before the slash is a folder name
            // rather than a word in a sentence, and suggestedFolder builds this
            // path with the project's own capitalisation intact — so the rule's
            // version would describe something the code does not do. Left as is:
            // obsidianmd rules cannot be disabled inline.
            text.setPlaceholder("Projects/New project").onChange((value) => {
              this.folderEdited = true;
              this.folderPath = value;
              this.validate();
            });
            new FolderSuggest(this.app, text.inputEl, () => {
              this.folderEdited = true;
              this.folderPath = text.inputEl.value;
              this.validate();
            });
          });
      });

    // The reason Create is disabled belongs beside it, not above the form.
    this.statusEl = this.actionsLeft.createDiv({ cls: "pt-modal-status" });
    this.createButton = this.setPrimaryAction({
      text: "Create project",
      onClick: () => void this.submit(),
    });
    this.validate();
  }

  private suggestedFolder(name: string): string {
    const safe = sanitizeFileName(name);
    if (!safe) return "";
    const base = this.plugin.settings.defaultProjectsFolder;
    return base ? `${base}/${safe}` : safe;
  }

  /** Returns an error message, or null when the form is good to submit. */
  private problem(): string | null {
    if (!this.name.trim()) return "Give the project a name.";
    if (!sanitizeFileName(this.name))
      return "That name has no usable characters for a file name.";
    if (!this.folderPath.trim()) return "Choose a folder.";

    const existing = this.app.vault.getAbstractFileByPath(
      normalizePath(this.folderPath),
    );
    if (!existing) return null;
    if (!(existing instanceof TFolder))
      return "That path is a file, not a folder.";
    if (existing.children.length) {
      return `"${existing.path}" is not empty — projects need an empty folder.`;
    }
    return null;
  }

  private validate(): void {
    const problem = this.problem();
    this.statusEl.setText(problem ?? "");
    this.statusEl.toggleClass("is-error", problem !== null);
    this.createButton.setDisabled(problem !== null);
  }

  private async submit(): Promise<void> {
    if (this.problem()) return;
    this.createButton.setDisabled(true);

    try {
      const path = normalizePath(this.folderPath);
      let folder = this.app.vault.getAbstractFileByPath(path);
      if (!folder) folder = await this.app.vault.createFolder(path);
      if (!(folder instanceof TFolder))
        throw new Error("Target path is not a folder.");

      const { configFile } = await createProject(this.app, {
        name: this.name.trim(),
        description: this.description,
        color: this.color,
        icon: this.icon,
        folder,
        statuses: templateStatuses(this.plugin.settings),
      });

      const project = await this.plugin.awaitProject(configFile.path);
      if (project) await this.seedExampleTasks(project);

      this.close();
      await this.plugin.openProject(configFile.path);
    } catch (error) {
      console.error("Project Tracker: failed to create project", error);
      new Notice(
        `Could not create the project — ${String(error)}`,
      );
      this.createButton.setDisabled(false);
    }
  }

  /**
   * Boilerplate so a new board opens with something in it. The second task
   * follows the first status's own next-status chain rather than a hard-coded
   * "upcoming", so a custom status template seeds its own second stage.
   */
  private async seedExampleTasks(project: Project): Promise<void> {
    const first = project.statusOrder[0] ?? "";
    await createTask(this.app, project, {
      name: "First Task",
      status: first,
      prioritized: false,
      labels: [],
      parent: null,
      start: null,
      due: null,
      description: "Describe the first piece of work here.",
      custom: {},
    });

    const next = project.statuses[first]?.nextStatus;
    if (!next || next === first || !project.statuses[next]) return;
    await createTask(this.app, project, {
      name: "Second Task",
      status: next,
      prioritized: false,
      labels: [],
      parent: null,
      start: null,
      due: null,
      description: "Work that is ready to be picked up sits here.",
      custom: {},
    });
  }
}
