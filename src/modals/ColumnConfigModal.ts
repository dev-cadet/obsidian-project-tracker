import { SettingGroup } from "obsidian";
import type { App } from "obsidian";
import type { Project } from "../types";
import { PluginModal } from "../ui/PluginModal";
import { Button } from "../ui/Button";

/** Everything a docked column shows, and the whole of what it stores. */
export interface ColumnConfig {
  projectId: string | null;
  statusKey: string | null;
  showDescription: boolean;
  showExtras: boolean;
}

/** What Clear puts the leaflet back to: unconfigured, as a new one opens. */
export const EMPTY_COLUMN_CONFIG: ColumnConfig = {
  projectId: null,
  statusKey: null,
  showDescription: false,
  showExtras: true,
};

/**
 * The dialog behind a docked column's configure button.
 *
 * Edits a copy and hands it back on save, so cancelling leaves the leaf exactly
 * as it was. The project and status dropdowns are drawn together because the
 * second depends on the first: changing project redraws the body with that
 * project's statuses.
 */
export class ColumnConfigModal extends PluginModal {
  private draft: ColumnConfig;
  private bodyEl!: HTMLElement;

  constructor(
    app: App,
    private projects: Project[],
    value: ColumnConfig,
    private onSave: (value: ColumnConfig) => void,
  ) {
    super(app, { header: "Configure Column" });
    this.draft = { ...value };
  }

  onOpen(): void {
    this.bodyEl = this.content.createDiv();

    // Saves the empty config rather than only closing: clearing is a change to
    // the leaflet, not a way out of the dialog.
    new Button(this.actionsLeft, {
      text: "Clear",
      onClick: () => {
        this.onSave({ ...EMPTY_COLUMN_CONFIG });
        this.close();
      },
    });

    this.addCancelAction();
    this.setPrimaryAction({
      text: "Save",
      onClick: () => {
        this.onSave(this.draft);
        this.close();
      },
    });

    this.renderBody();
  }

  private renderBody(): void {
    this.bodyEl.empty();

    if (!this.projects.length) {
      this.bodyEl.createDiv({
        cls: "pane-empty",
        text: "No projects found in this vault.",
      });
      return;
    }

    // A column always resolves to something once there is a project to resolve
    // to, so an unset or stale draft is settled here rather than being left for
    // the view to interpret.
    const project =
      this.projects.find((candidate) => candidate.id === this.draft.projectId) ??
      this.projects[0];
    this.draft.projectId = project.id;
    if (!this.draft.statusKey || !project.statuses[this.draft.statusKey]) {
      this.draft.statusKey = project.statusOrder[0] ?? null;
    }

    new SettingGroup(this.bodyEl)
      .setHeading("Source")
      .addSetting((setting) => {
        setting.setName("Project").addDropdown((dropdown) => {
          for (const candidate of this.projects) {
            dropdown.addOption(candidate.id, candidate.title);
          }
          dropdown.setValue(project.id).onChange((value) => {
            this.draft.projectId = value;
            // The status belongs to the project being left behind, so it cannot
            // carry over; redrawing settles it against the new one.
            this.draft.statusKey = null;
            this.renderBody();
          });
        });
      })
      .addSetting((setting) => {
        setting
          .setName("Status")
          .setDesc("The one status this column lists.")
          .addDropdown((dropdown) => {
            for (const key of project.statusOrder) {
              dropdown.addOption(key, project.statuses[key]?.name ?? key);
            }
            dropdown
              .setValue(this.draft.statusKey ?? "")
              .onChange((value) => {
                this.draft.statusKey = value;
              });
          });
      });

    new SettingGroup(this.bodyEl)
      .setHeading("Cards")
      .addSetting((setting) => {
        setting
          .setName("Show description")
          .setDesc("The first line of the task's description, under its name.")
          .addToggle((toggle) =>
            toggle.setValue(this.draft.showDescription).onChange((value) => {
              this.draft.showDescription = value;
            }),
          );
      })
      .addSetting((setting) => {
        setting
          .setName("Show extras")
          .setDesc("Labels, priority and due date, on the line under the name.")
          .addToggle((toggle) =>
            toggle.setValue(this.draft.showExtras).onChange((value) => {
              this.draft.showExtras = value;
            }),
          );
      });
  }
}
