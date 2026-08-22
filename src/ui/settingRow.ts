import { Setting } from "obsidian";

/**
 * ChildPosition: bottom — the control sits under its label rather than beside
 * it. Obsidian only stacks a row inside `@container (max-width: 400px)`, which
 * a dialog this wide never matches, so `.pt-item-stacked` applies the app's own
 * stacked treatment unconditionally.
 *
 * A function rather than an option, because SettingGroup hands back a Setting
 * and there is nowhere to pass one through.
 */
export function stacked(setting: Setting): Setting {
  setting.settingEl.addClass("pt-item-stacked");
  return setting;
}

/**
 * ChildPosition: bottom *and* right — a row that keeps its control beside the
 * label and puts a second child on a full-width row underneath both.
 *
 * `stacked` cannot do this: it moves the control itself to the bottom, so a row
 * can have one position or the other. Here the button stays on the right and the
 * value it acts on sits below, which is the shape a row needs when the control
 * is small and the thing it names is not.
 *
 * Returns the element to render into, empty and hidden until something is put
 * in it.
 */
export function footer(setting: Setting): HTMLElement {
  setting.settingEl.addClass("pt-item-has-footer");
  return setting.settingEl.createDiv({ cls: "pt-item-footer" });
}
