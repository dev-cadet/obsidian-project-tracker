import { App, Notice, SettingGroup } from "obsidian";
import type ProjectTrackerPlugin from "../main";
import type { NewTaskInput, Project } from "../types";
import { createTask } from "../io/taskFile";
import { Button } from "../ui/Button";
import { PluginModal } from "../ui/PluginModal";
import { footer, stacked } from "../ui/settingRow";
import { renderCustomFields } from "./propertyField";
import { TaskSuggestModal } from "./TaskSuggestModal";
import { defaultCustomValues } from "../util/customFields";

export class NewTaskModal extends PluginModal {
  private input: NewTaskInput;
  private createButton!: Button;

  constructor(
    app: App,
    private plugin: ProjectTrackerPlugin,
    private project: Project,
    presetStatus?: string,
  ) {
    super(app, {
      header: "New Task",
      subHeader: project.title,
      accent: project.color,
    });
    const status =
      presetStatus && project.statuses[presetStatus]
        ? presetStatus
        : (project.statusOrder[0] ?? "");
    this.input = {
      name: "",
      status,
      prioritized: false,
      labels: [],
      parent: null,
      start: null,
      due: null,
      description: "",
      custom: defaultCustomValues(project.customFields),
    };
  }

  onOpen(): void {
    // Untitled, like the first group of Obsidian's own General tab: every row
    // in it is a field of the task itself.
    const fields = new SettingGroup(this.content)
      .addSetting((setting) => {
        stacked(setting)
          .setName("Title")
          .addText((text) => {
            text.setPlaceholder("What needs doing?").onChange((value) => {
              this.input.name = value;
              this.createButton.setDisabled(!value.trim());
            });
            this.focusOnOpen(text.inputEl);
          });
      })
      .addSetting((setting) => {
        setting.setName("Status").addDropdown((dropdown) => {
          for (const key of this.project.statusOrder) {
            dropdown.addOption(key, this.project.statuses[key].name);
          }
          dropdown.setValue(this.input.status).onChange((value) => {
            this.input.status = value;
          });
        });
      })
      .addSetting((setting) => {
        setting
          .setName("Prioritized")
          .setDesc("Flags the task on the board.")
          .addToggle((toggle) =>
            toggle.setValue(false).onChange((value) => {
              this.input.prioritized = value;
            }),
          );
      })
      .addSetting((setting) => {
        setting.setName("Start date").addText((text) => {
          text.inputEl.type = "date";
          text.onChange((value) => {
            this.input.start = value || null;
          });
        });
      })
      .addSetting((setting) => {
        setting.setName("Due date").addText((text) => {
          text.inputEl.type = "date";
          text.onChange((value) => {
            this.input.due = value || null;
          });
        });
      });

    this.renderLabels(fields);
    this.renderParent(fields);

    fields.addSetting((setting) => {
      stacked(setting)
        .setName("Description")
        .addTextArea((text) =>
          text.setPlaceholder("Describe the work…").onChange((value) => {
            this.input.description = value;
          }),
        );
    });

    if (this.project.customFields.length) {
      const custom = new SettingGroup(this.content).setHeading("Custom Fields");
      renderCustomFields(
        this.app,
        custom.listEl.createDiv({ cls: "pt-config-block" }),
        this.project.customFields,
        this.input.custom,
      );
    }

    this.createButton = this.setPrimaryAction({
      text: "Create task",
      disabled: true,
      onClick: () => void this.submit(),
    });
  }

  /**
   * The task this one will belong under.
   *
   * Every task in the project is a candidate. The editor has to exclude its own
   * descendants or assigning one would close the chain into a loop; here there
   * is no note yet, so nothing can already be beneath it and there is nothing to
   * exclude.
   *
   * The row never navigates either. The editor allows it once the parent is
   * saved, and nothing here is saved until Create.
   */
  private renderParent(group: SettingGroup): void {
    group.addSetting((setting) => {
      setting
        .setName("Parent task")
        .setDesc("The task this one belongs under.");

      const current = footer(setting);

      // One button doing whichever of the two jobs applies, as in the editor:
      // clear what is there, or pick when there is nothing.
      const paint = (): void => {
        current.empty();
        setting.controlEl.empty();

        // Looked up rather than stored: the draft only ever holds the path.
        const parent = this.input.parent
          ? this.plugin.store.getTaskByPath(this.input.parent)
          : null;
        current.toggle(Boolean(parent));

        if (parent) {
          const row = current.createDiv({ cls: "pt-task-row is-static" });
          const dot = row.createSpan({ cls: "pt-status-dot" });
          dot.style.setProperty(
            "--pt-status-color",
            this.project.statuses[parent.status]?.color ?? "#6e7781",
          );
          row.createSpan({ cls: "pt-task-row-name", text: parent.name });
        }

        new Button(setting.controlEl, {
          icon: parent ? "x" : "plus",
          tooltip: parent ? "Clear parent task" : "Assign a parent task",
          class: parent ? "pt-clear-button" : undefined,
          onClick: () => {
            if (parent) {
              this.input.parent = null;
              paint();
              return;
            }
            const candidates = this.plugin.store.getTasks(this.project.id);
            new TaskSuggestModal(this.app, candidates, (chosen) => {
              this.input.parent = chosen.file.path;
              paint();
            }).open();
          },
        });
      };

      paint();
    });
  }

  private renderLabels(group: SettingGroup): void {
    const keys = Object.keys(this.project.labels);
    if (!keys.length) return;

    let chips!: HTMLElement;
    group.addSetting((setting) => {
      stacked(setting).setName("Labels");
      chips = setting.controlEl;
    });

    for (const key of keys) {
      const label = this.project.labels[key];
      const chip = new Button(chips, {
        text: label.name,
        variant: this.input.labels.includes(key) ? "cta" : "normal",
        onClick: () => {
          const index = this.input.labels.indexOf(key);
          if (index === -1) this.input.labels.push(key);
          else this.input.labels.splice(index, 1);
          chip.setVariant(index === -1 ? "cta" : "normal");
        },
      });
    }
  }

  private async submit(): Promise<void> {
    if (!this.input.name.trim()) return;
    this.createButton.setDisabled(true);
    try {
      const file = await createTask(this.app, this.project, this.input);
      this.close();
      if (this.plugin.settings.openTaskAfterCreate) {
        await this.app.workspace.getLeaf(false).openFile(file);
      } else if (this.project.board.openTasksInBoard) {
        await this.plugin.openProject(this.project.configFile.path);
      }
    } catch (error) {
      console.error("Project Tracker: failed to create task", error);
      new Notice(
        `Could not create the task — ${String(error)}`,
      );
      this.createButton.setDisabled(false);
    }
  }
}
