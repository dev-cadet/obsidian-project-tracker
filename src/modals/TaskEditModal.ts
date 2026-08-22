import { MarkdownView, Notice, SettingGroup, setIcon } from "obsidian";
import type ProjectTrackerPlugin from "../main";
import type { Project, Task } from "../types";
import { type TaskEdits, updateTask } from "../io/taskFile";
import { parentCandidates } from "../store/query";
import { TaskSuggestModal } from "./TaskSuggestModal";
import {
  getSectionContent,
  getSectionText,
  splitFrontmatter,
} from "../io/sections";
import { Button } from "../ui/Button";
import { PluginModal } from "../ui/PluginModal";
import { footer, stacked } from "../ui/settingRow";
import { renderCustomFields } from "./propertyField";

export class TaskEditModal extends PluginModal {
  private edits: TaskEdits;
  private changeLog = "";
  private loaded = false;
  private saving = false;
  private bodyEl!: HTMLElement;

  /**
   * `onBack` reopens whatever this was opened from. Set only when one task
   * editor opens another, so a modal reached directly has no back button.
   */
  constructor(
    private plugin: ProjectTrackerPlugin,
    private project: Project,
    private task: Task,
    private onBack: (() => void) | null = null,
  ) {
    super(plugin.app, {
      header: "Edit Task",
      subHeader: project.title,
      accent: project.color,
    });
    this.edits = {
      name: task.name,
      status: task.status,
      prioritized: task.prioritized,
      labels: [...task.labels],
      parent: task.parentPath,
      start: task.start,
      due: task.due,
      description: "",
      notes: "",
      // Copied so cancelling the modal cannot mutate the indexed task.
      custom: { ...task.custom },
    };
  }

  onOpen(): void {
    this.bodyEl = this.content.createDiv();
    this.bodyEl.createDiv({ cls: "pt-modal-status", text: "Loading…" });

    if (this.onBack) {
      new Button(this.actionsLeft, {
        text: "Back",
        icon: "arrow-left",
        onClick: () => {
          this.close();
          this.onBack?.();
        },
      });
    }

    // Built before the note is read: Save already guards on `loaded`.
    new Button(this.actionsRight, {
      text: "Open note",
      icon: "file-text",
      onClick: () => void this.openNote(),
    });
    this.setPrimaryAction({
      text: "Save",
      onClick: () => void this.submit(),
    });

    void this.load();
  }

  /** Description, Notes and the log live in the note, not in the index. */
  private async load(): Promise<void> {
    try {
      const { body } = splitFrontmatter(
        await this.app.vault.cachedRead(this.task.file),
      );
      this.edits.description = getSectionContent(body, "Description");
      this.edits.notes = getSectionContent(body, "Notes");
      this.changeLog = getSectionText(body, "Change Log");
      this.loaded = true;
    } catch (error) {
      console.error("Project Tracker: could not read the task note", error);
      new Notice("Could not read the task note.");
      this.close();
      return;
    }
    this.renderBody();
  }

  private renderBody(): void {
    this.bodyEl.empty();
    // Untitled, like the first group of Obsidian's own General tab: every row
    // in it is a field of the task itself.
    const fields = new SettingGroup(this.bodyEl)
      .addSetting((setting) => {
        stacked(setting)
          .setName("Title")
          .addText((text) =>
            text.setValue(this.edits.name).onChange((value) => {
              this.edits.name = value;
            }),
          );
      })
      .addSetting((setting) => {
        setting.setName("Status").addDropdown((dropdown) => {
          for (const key of this.project.statusOrder) {
            dropdown.addOption(key, this.project.statuses[key].name);
          }
          // A status the project no longer defines would otherwise vanish silently.
          if (!this.project.statuses[this.edits.status]) {
            dropdown.addOption(
              this.edits.status,
              `${this.edits.status} (unknown)`,
            );
          }
          dropdown.setValue(this.edits.status).onChange((value) => {
            this.edits.status = value;
          });
        });
      })
      .addSetting((setting) => {
        setting
          .setName("Prioritized")
          .setDesc("Flags the task on the board.")
          .addToggle((toggle) =>
            toggle.setValue(this.edits.prioritized).onChange((value) => {
              this.edits.prioritized = value;
            }),
          );
      })
      .addSetting((setting) => {
        setting.setName("Start date").addText((text) => {
          text.inputEl.type = "date";
          text.setValue(this.edits.start ?? "").onChange((value) => {
            this.edits.start = value || null;
          });
        });
      })
      .addSetting((setting) => {
        setting.setName("Due date").addText((text) => {
          text.inputEl.type = "date";
          text.setValue(this.edits.due ?? "").onChange((value) => {
            this.edits.due = value || null;
          });
        });
      });

    this.renderLabels(fields);

    this.renderParent(fields);

    fields
      .addSetting((setting) => {
        stacked(setting)
          .setName("Description")
          .addTextArea((text) =>
            text.setValue(this.edits.description).onChange((value) => {
              this.edits.description = value;
            }),
          );
      })
      .addSetting((setting) => {
        stacked(setting)
          .setName("Notes")
          .addTextArea((text) =>
            text.setValue(this.edits.notes).onChange((value) => {
              this.edits.notes = value;
            }),
          );
      });

    if (this.project.customFields.length) {
      const custom = new SettingGroup(this.bodyEl).setHeading("Custom Fields");
      renderCustomFields(
        this.app,
        custom.listEl.createDiv({ cls: "pt-config-block" }),
        this.project.customFields,
        this.edits.custom,
      );
    }

    this.renderChildren(this.bodyEl);
    this.renderChangeLog(this.bodyEl);
  }

  /**
   * Swap this editor for another task's, leaving a trail back to it.
   *
   * Unsaved edits are dropped, the same as closing the dialog any other way:
   * moving to a different task is navigation, not a save.
   */
  private openTask(next: Task): void {
    const back = (): void => {
      new TaskEditModal(this.plugin, this.project, this.task, this.onBack).open();
    };
    this.close();
    new TaskEditModal(this.plugin, this.project, next, back).open();
  }

  /**
   * The task this one belongs under.
   *
   * Held as a vault path in the draft and written out as a wikilink, so the
   * parent shows in the graph and Obsidian keeps the link right when a note is
   * renamed. The name is looked up each time it is painted rather than stored:
   * the draft only ever holds the path.
   */
  private renderParent(group: SettingGroup): void {
    group.addSetting((setting) => {
      setting
        .setName("Parent task")
        .setDesc("The task this one belongs under.");

      const current = footer(setting);

      const choose = (): void => {
        const candidates = parentCandidates(
          this.plugin.store.getTasks(this.project.id),
          this.task,
        );
        new TaskSuggestModal(this.app, candidates, (chosen) => {
          this.edits.parent = chosen.file.path;
          paint();
        }).open();
      };

      // One button for both jobs: clear what is there, or add when there is
      // nothing. Changing a parent is remove then add, which is two clicks and
      // one control rather than one click and two.
      const paint = (): void => {
        current.empty();
        setting.controlEl.empty();

        const assigned = Boolean(this.edits.parent);
        current.toggle(assigned);

        if (assigned) {
          const parent = this.plugin.store.getTaskByPath(this.edits.parent as string);
          const row = current.createDiv({ cls: "pt-task-row" });
          // The status dot the child rows use, so both sections read the same.
          // Left at its faint default when the note has gone, since a task that
          // is not there has no status to show.
          const dot = row.createSpan({ cls: "pt-status-dot" });
          if (parent) {
            dot.style.setProperty(
              "--pt-status-color",
              this.project.statuses[parent.status]?.color ?? "#6e7781",
            );
          }
          row.createSpan({
            cls: "pt-task-row-name",
            text: parent?.name ?? "Missing task",
          });

          // Only navigable once the note says so. Leaving on an unsaved change
          // discards it, so an assignment that has not been saved would send you
          // to a task this one is not yet the child of.
          const pending = this.edits.parent !== this.task.parentPath;
          if (parent && !pending) {
            setIcon(row.createSpan({ cls: "pt-task-row-open" }), "chevron-right");
            row.addEventListener("click", () => this.openTask(parent));
          } else {
            row.addClass("is-static");
            // A path with no task behind it is a parent whose note has gone.
            if (!parent) row.addClass("is-missing");
            else row.setAttr("aria-label", "Save the task to open this");
          }
        }

        new Button(setting.controlEl, {
          icon: assigned ? "x" : "plus",
          tooltip: assigned ? "Clear parent task" : "Assign a parent task",
          class: assigned ? "pt-clear-button" : undefined,
          onClick: () => {
            if (!assigned) {
              choose();
              return;
            }
            this.edits.parent = null;
            paint();
          },
        });
      };

      paint();
    });
  }

  /**
   * The tasks that name this one as their parent.
   *
   * Read from the index rather than from the note: the relationship is stored on
   * the child, so nothing here is editable — a child is unassigned from its own
   * editor, which is where the field lives.
   */
  private renderChildren(parent: HTMLElement): void {
    const children = this.plugin.store.getChildTasks(this.task.file.path);
    const list = new SettingGroup(parent)
      .setHeading("Assigned Children")
      .listEl.createDiv({ cls: "pt-config-block pt-task-list" });

    if (!children.length) {
      list.createDiv({ cls: "pt-modal-status", text: "No tasks assigned to this one." });
      return;
    }

    for (const child of children) {
      const row = list.createDiv({ cls: "pt-task-row" });
      const dot = row.createSpan({ cls: "pt-status-dot" });
      dot.style.setProperty(
        "--pt-status-color",
        this.project.statuses[child.status]?.color ?? "#6e7781",
      );
      row.createSpan({ cls: "pt-task-row-name", text: child.name });
      setIcon(row.createSpan({ cls: "pt-task-row-open" }), "chevron-right");

      row.addEventListener("click", () => this.openTask(child));
    }
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
        variant: this.edits.labels.includes(key) ? "cta" : "normal",
        onClick: () => {
          const index = this.edits.labels.indexOf(key);
          if (index === -1) this.edits.labels.push(key);
          else this.edits.labels.splice(index, 1);
          chip.setVariant(index === -1 ? "cta" : "normal");
        },
      });
    }
  }

  private renderChangeLog(parent: HTMLElement): void {
    const log = new SettingGroup(parent)
      .setHeading("Change Log")
      .listEl.createDiv({ cls: "pt-config-block pt-changelog" });

    if (!this.changeLog.trim()) {
      log.createDiv({ cls: "pt-modal-status", text: "Nothing recorded yet." });
      return;
    }

    // Newest first: the note appends chronologically, which reads backwards here.
    for (const line of this.changeLog.split("\n").reverse()) {
      const text = line.trim();
      if (!text) continue;
      const heading = /^#{1,6}\s+(.*)$/.exec(text);
      if (heading) {
        log.createDiv({ cls: "pt-changelog-date", text: heading[1] });
      } else {
        log.createDiv({ cls: "pt-changelog-entry", text });
      }
    }
  }

  /** Reuses the tab the note is already in rather than opening another. */
  private async openNote(): Promise<void> {
    const path = this.task.file.path;
    const open = this.app.workspace
      .getLeavesOfType("markdown")
      .find((leaf) => (leaf.view as MarkdownView).file?.path === path);

    this.close();
    if (open) {
      this.app.workspace.setActiveLeaf(open, { focus: true });
      await this.app.workspace.revealLeaf(open);
      return;
    }
    await this.app.workspace.getLeaf(false).openFile(this.task.file);
  }

  private async submit(): Promise<void> {
    if (!this.loaded || this.saving) return;
    if (!this.edits.name.trim()) {
      new Notice("Give the task a title.");
      return;
    }

    this.saving = true;
    try {
      const { entries } = await updateTask(
        this.app,
        this.project,
        this.task,
        this.edits,
      );
      this.close();
      if (entries.length) {
        new Notice(
          `Logged ${entries.length} change${entries.length === 1 ? "" : "s"}.`,
        );
      }
    } catch (error) {
      console.error("Project Tracker: failed to save the task", error);
      new Notice(
        "Could not save the task — see the console for details.",
      );
      this.saving = false;
    }
  }
}
