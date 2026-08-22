import { ButtonComponent } from "obsidian";

/**
 * Obsidian's three button looks, under its own names. `normal` is the resting
 * control, `cta` the accent-filled confirming action, `warning` the destructive
 * one. There is deliberately no fourth: anything the app cannot express is a
 * look we would have to draw and then keep in step by hand, which is what this
 * component exists to stop.
 */
export type ButtonVariant = "normal" | "cta" | "warning";

export interface ButtonOptions {
  text?: string;
  /** Any id Obsidian has registered — see IconPickerModal for the full list. */
  icon?: string;
  variant?: ButtonVariant;
  tooltip?: string;
  disabled?: boolean;
  /** Escape hatch for a caller that needs to hang layout off the element. */
  class?: string;
  onClick?: (event: MouseEvent) => void;
}

/**
 * Every standard button in the plugin.
 *
 * It is Obsidian's own ButtonComponent with a fixed set of options, so the look
 * is the app's and follows whatever the theme does. The point of the wrapper is
 * that it is the only place a button gets built, and it adds no styling of its
 * own — a button here is exactly what Obsidian makes a `<button>`.
 *
 * Not everything that is a `<button>` belongs here. Tabs, chips and table
 * headers are their own controls with their own behaviour, and they stay on
 * their own classes.
 */
export class Button {
  readonly el: HTMLButtonElement;
  private readonly component: ButtonComponent;

  constructor(parent: HTMLElement, options: ButtonOptions = {}) {
    this.component = new ButtonComponent(parent);
    this.el = this.component.buttonEl;
    // Inside a <form> a button submits unless told otherwise.
    this.el.setAttr("type", "button");
    if (options.class !== undefined) this.el.addClass(options.class);

    // Text before icon, matching what ButtonComponent's own callers do. Note
    // the two do not compose: setButtonText writes a text node, setIcon drops
    // the first child and appends the SVG, so the later call wins and a button
    // given both ends up icon-only.
    if (options.text !== undefined) this.setText(options.text);
    if (options.icon !== undefined) this.setIcon(options.icon);
    this.setVariant(options.variant ?? "normal");
    if (options.tooltip !== undefined) this.setTooltip(options.tooltip);
    if (options.disabled !== undefined) this.setDisabled(options.disabled);
    if (options.onClick) this.onClick(options.onClick);
  }

  setText(text: string): this {
    this.component.setButtonText(text);
    return this;
  }

  setIcon(icon: string): this {
    this.component.setIcon(icon);
    return this;
  }

  setVariant(variant: ButtonVariant): this {
    // Cleared first so the setter can also be used to change an existing button.
    this.component.removeCta();
    this.component.removeDestructive();
    if (variant === "cta") this.component.setCta();
    // setWarning is the deprecated spelling of this, and removeDestructive above
    // was already the current one — so the pair had drifted apart and only
    // worked because both touch the same class.
    if (variant === "warning") this.component.setDestructive();
    return this;
  }

  setTooltip(tooltip: string): this {
    this.component.setTooltip(tooltip);
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.component.setDisabled(disabled);
    return this;
  }

  onClick(handler: (event: MouseEvent) => void): this {
    this.component.onClick(handler);
    return this;
  }
}
