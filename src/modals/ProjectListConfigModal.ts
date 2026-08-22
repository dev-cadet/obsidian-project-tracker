import { SettingGroup } from "obsidian";
import type { App } from "obsidian";
import { PluginModal } from "../ui/PluginModal";

/** What a projects list shows on each card, and the whole of what it stores. */
export interface ProjectListConfig {
  showDescription: boolean;
  showCount: boolean;
}

/** Everything on, which is what a list that has never been configured shows. */
export const DEFAULT_PROJECT_LIST_CONFIG: ProjectListConfig = {
  showDescription: true,
  showCount: true,
};

/**
 * The dialog behind the projects list's configure button.
 *
 * Edits a copy and hands it back on save, so cancelling leaves the view exactly
 * as it was — the same contract as the task column's dialog.
 */
export class ProjectListConfigModal extends PluginModal {
  private draft: ProjectListConfig;

  constructor(
    app: App,
    value: ProjectListConfig,
    private onSave: (value: ProjectListConfig) => void,
  ) {
    super(app, { header: "Configure Projects" });
    this.draft = { ...value };
  }

  onOpen(): void {
    new SettingGroup(this.content)
      .setHeading("Cards")
      .addSetting((setting) => {
        setting
          .setName("Show description")
          .setDesc("The first line of the project's description.")
          .addToggle((toggle) =>
            toggle.setValue(this.draft.showDescription).onChange((value) => {
              this.draft.showDescription = value;
            }),
          );
      })
      .addSetting((setting) => {
        setting
          .setName("Show task count")
          .addToggle((toggle) =>
            toggle.setValue(this.draft.showCount).onChange((value) => {
              this.draft.showCount = value;
            }),
          );
      });

    this.addCancelAction();
    this.setPrimaryAction({
      text: "Save",
      onClick: () => {
        this.onSave(this.draft);
        this.close();
      },
    });
  }
}
