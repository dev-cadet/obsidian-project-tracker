/**
 * Drag-to-reorder for a rendered list.
 *
 * HTML5 drag-and-drop, not an Obsidian API. The app does ship this — a
 * `SettingDefinitionList` with `onReorder` gets a drag handle and the reorder
 * for free — but only through `getSettingDefinitions()` on a settings tab,
 * rendered by Obsidian's own settings page. There is no public way to put one
 * inside a modal, so this is hand-rolled.
 *
 * One instance per rendered list. The drag source has to be remembered across
 * rows because `dataTransfer` cannot be read during `dragover`, which is where
 * the drop target has to decide whether to accept.
 */
export class DragReorder {
  private from: number | null = null;

  /**
   * `move` receives indices into the caller's own array and is expected to
   * splice and re-render.
   */
  constructor(private move: (from: number, to: number) => void) {}

  /**
   * `handle` starts the drag, `row` receives the drop. Pass the same element
   * for both to make the whole row draggable — worth avoiding when the row
   * holds a text input, since a draggable ancestor swallows text selection.
   */
  attach(row: HTMLElement, handle: HTMLElement, index: number): void {
    handle.draggable = true;

    handle.addEventListener("dragstart", (event) => {
      this.from = index;
      event.dataTransfer?.setData("text/plain", String(index));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      // Without this the ghost is the grip alone, which gives no sense of
      // what is being moved.
      event.dataTransfer?.setDragImage(row, 12, row.clientHeight / 2);

      // Marked a frame later, not now. The ghost is a snapshot the browser
      // takes after this handler returns, so a mark that fades the row — or
      // empties it, which is what the projects page does — would otherwise be
      // what gets dragged around. The guard is for a drag cancelled before the
      // frame arrives, which would leave the mark on with nothing to remove it.
      window.requestAnimationFrame(() => {
        if (this.from === index) row.addClass("is-dragging");
      });
    });

    handle.addEventListener("dragend", () => {
      this.from = null;
      row.removeClass("is-dragging");
    });

    row.addEventListener("dragover", (event) => {
      if (this.from === null || this.from === index) return;
      // Without preventDefault the drop never fires: the default is "reject".
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      row.addClass("is-drop-target");
    });

    row.addEventListener("dragleave", (event) => {
      if (!row.contains(event.relatedTarget as Node))
        row.removeClass("is-drop-target");
    });

    row.addEventListener("drop", (event) => {
      event.preventDefault();
      row.removeClass("is-drop-target");
      const from = this.from;
      this.from = null;
      if (from === null || from === index) return;
      this.move(from, index);
    });
  }
}
