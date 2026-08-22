import { App, Modal, Platform } from "obsidian";
import { Button } from "./Button";

export interface PluginModalOptions {
  header?: string;
  subHeader?: string;
  /**
   * Overrides Obsidian's `--dialog-width` (560px) for this dialog only. A
   * token rather than a class, so `--dialog-max-width` still caps it on a
   * narrow screen. Ignored on a phone, where a dialog is the width of the
   * screen and there is nothing left to choose.
   */
  width?: string;
  /**
   * The colour of the project this dialog is about, which its confirming action
   * wears in place of the vault's accent.
   *
   * Only for a dialog that belongs to one project. A dialog that does not — the
   * projects list's own options, a new project that has no colour yet — leaves
   * it unset and keeps the app's accent, because there is nothing for it to be
   * the colour of.
   */
  accent?: string;
}

/**
 * The plugin's dialog shell: a fixed title band, a body that scrolls on its
 * own, and a pinned row of actions.
 *
 * All three come from Obsidian. `.modal` is already a flex column, and
 * `mod-scrollable-content` is the app's own variant for exactly this shape — it
 * moves the padding onto the title, gives `.modal-content` its own scrollbar,
 * and puts the top border and padding on `.modal-button-container`. Within that
 * row, `.mod-secondary` carries `margin-inline-end: auto`, which is what splits
 * the actions left from right.
 *
 * On a phone it takes the app's sheet shape as well: `mod-lg` makes the dialog
 * full height and anchors it to the bottom edge. The action row stays where it
 * is on every other screen — the app also offers a form sheet that moves the
 * confirming action into the header, and that is deliberately not used here.
 *
 * Subclasses render into `content` from `onOpen` and add buttons to
 * `actionsLeft` / `actionsRight`.
 */
export abstract class PluginModal extends Modal {
  /** The body. The only part that scrolls. */
  protected readonly content: HTMLElement;
  private readonly subHeaderEl: HTMLElement;

  // Built on first use rather than up front, so a dialog that adds nothing to
  // one side does not carry an empty group, and one that adds nothing at all
  // does not carry the row.
  private actionsEl: HTMLElement | null = null;
  private leftEl: HTMLElement | null = null;
  private rightEl: HTMLElement | null = null;

  constructor(app: App, options: PluginModalOptions = {}) {
    super(app);
    // pt-modal marks the dialog as ours, so plugin-wide rules can reach inside
    // it without touching the app's own dialogs.
    this.modalEl.addClass("mod-scrollable-content", "pt-modal");

    // The app's own sheet: full height, anchored to the bottom edge. What it
    // buys on a phone is that the dialog stops being a card floating in the
    // middle of the screen and starts where the thumb already is.
    if (Platform.isPhone) this.modalEl.addClass("mod-lg");

    if (options.width && !Platform.isPhone)
      this.modalEl.style.setProperty("--dialog-width", options.width);

    // The class as well as the token: the stylesheet only redirects the accent
    // where there is a colour to redirect it to, so an unset --pt-project-color
    // can never leave --interactive-accent invalid.
    if (options.accent) {
      this.modalEl.addClass("pt-modal-accent");
      this.modalEl.style.setProperty("--pt-project-color", options.accent);
    }

    // Sits under the title inside the header, so it scrolls with neither the
    // title nor the body. Hides itself when there is nothing to say.
    // .modal-header exists at runtime but is not in the public typings, so it
    // is reached through titleEl, which is.
    const header = this.titleEl.parentElement ?? this.modalEl;
    this.subHeaderEl = header.createDiv({ cls: "pt-modal-subheader" });

    // Modal builds its own close button with mod-raised, which on a phone fills
    // and outlines it — a tile floating over the content. That is for a button
    // sitting on a view it has to lift itself off; this one sits on a dialog,
    // and it drops the modifier to be the bare icon it is on a desktop.
    if (Platform.isMobile) {
      this.modalEl
        .querySelector(":scope > .modal-header-button")
        ?.removeClass("mod-raised");
    }

    this.content = this.contentEl;

    if (options.header !== undefined) this.setHeader(options.header);
    if (options.subHeader !== undefined) this.setSubHeader(options.subHeader);
  }

  /** Destructive or secondary actions, pushed to the start of the row. */
  protected get actionsLeft(): HTMLElement {
    this.leftEl ??= this.actions().createDiv({
      cls: "mod-secondary pt-modal-actions",
    });
    return this.leftEl;
  }

  /** Confirming actions, at the end of the row. */
  protected get actionsRight(): HTMLElement {
    this.rightEl ??= this.actions().createDiv({ cls: "pt-modal-actions" });
    return this.rightEl;
  }

  /**
   * The dialog's confirming action.
   *
   * Here rather than at each of the seven call sites, because a dialog gets one
   * and it is always the accent-filled button at the end of the row. Returned
   * so a form can enable and disable it as what has been typed changes.
   */
  protected setPrimaryAction(options: {
    text: string;
    disabled?: boolean;
    onClick: () => void;
  }): Button {
    return new Button(this.actionsRight, {
      text: options.text,
      variant: "cta",
      disabled: options.disabled,
      onClick: options.onClick,
    });
  }

  /** The dialog's dismissing action, beside the confirming one. */
  protected addCancelAction(text = "Cancel"): void {
    new Button(this.actionsRight, { text, onClick: () => this.close() });
  }

  /**
   * Put the cursor in a field as the dialog opens.
   *
   * Deferred, because the input is not in the document until the dialog is —
   * and skipped on mobile, where focusing a text field raises the keyboard over
   * half the sheet before the reader has seen what is being asked. The app
   * draws the same line: its own initial focus is gated on there being a
   * physical keyboard.
   */
  protected focusOnOpen(el: HTMLElement): void {
    if (Platform.isMobile) return;
    window.setTimeout(() => el.focus(), 0);
  }

  setHeader(header: string): this {
    this.titleEl.setText(header);
    return this;
  }

  setSubHeader(subHeader: string): this {
    this.subHeaderEl.setText(subHeader);
    return this;
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private actions(): HTMLElement {
    this.actionsEl ??= this.modalEl.createDiv({ cls: "modal-button-container" });
    return this.actionsEl;
  }
}
