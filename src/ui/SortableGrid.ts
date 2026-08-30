/**
 * Drag-to-reorder for a grid of tiles, where the tiles move out of the way.
 *
 * Different from `DragReorder` in what it shows, not in what it does. That one
 * marks a row and waits for a drop, which is legible in a settings list of a few
 * rows and is not on a wall of tiles: nothing tells you where the tile you are
 * holding would land until you let go of it.
 *
 * Here the arrangement happens as you drag. The tile being moved stays in the
 * grid as an outline and is re-inserted wherever the pointer says it belongs, so
 * the outline is always the slot it would take, and every other tile slides to
 * the position that leaves it there. Nothing is written until the drag ends.
 *
 * The sliding is FLIP: measure, mutate, put everything back where it looked like
 * it was, then let it travel. Animating layout directly is what it avoids — a
 * grid cannot be transitioned, but a transform can, and the transform is a lie
 * that starts true and resolves to nothing.
 */
export class SortableGrid {
	private items: HTMLElement[] = [];
	private dragged: HTMLElement | null = null;
	private from = -1;

	/**
	 * `commit` receives indices into the order the tiles were added in, and is
	 * expected to store the new arrangement and re-render.
	 */
	constructor(
		private container: HTMLElement,
		private commit: (from: number, to: number) => void
	) {
		// On the container rather than on each tile: the pointer spends as much of
		// a drag over the gaps between tiles as over the tiles themselves, and a
		// dragover that is not accepted there cancels the drop.
		container.addEventListener("dragover", (event) => {
			if (!this.dragged) return;
			// Without this the drop never fires: the default is "reject".
			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
			this.slideTo(event.clientX, event.clientY);
		});

		container.addEventListener("drop", (event) => {
			if (!this.dragged) return;
			event.preventDefault();
			this.finish();
		});
	}

	/** Tiles are added in the order they are rendered, which is the order reported. */
	add(tile: HTMLElement): void {
		const index = this.items.length;
		this.items.push(tile);
		tile.draggable = true;

		tile.addEventListener("dragstart", (event) => {
			this.dragged = tile;
			this.from = index;
			event.dataTransfer?.setData("text/plain", String(index));
			if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
			// Held where it was picked up, so the tile does not jump under the
			// cursor at the moment the drag starts. Measured against the tile and
			// not taken from event.offset*, which is relative to whatever child of
			// it was actually under the pointer — a title, an icon, a chip.
			const box = tile.getBoundingClientRect();
			event.dataTransfer?.setDragImage(
				tile,
				event.clientX - box.left,
				event.clientY - box.top
			);

			// Emptied a frame later, not now: the ghost is a snapshot the browser
			// takes after this handler returns, so emptying the tile here is what
			// would get dragged around. The guard is for a drag cancelled before
			// the frame arrives, which would leave the tile empty with nothing
			// left to fill it back in.
			window.requestAnimationFrame(() => {
				if (this.dragged === tile) tile.addClass("is-placeholder");
			});
		});

		// Fires whether the drop landed in the grid or nowhere at all, so it is
		// what guarantees the tile is filled back in.
		tile.addEventListener("dragend", () => this.finish());
	}

	/**
	 * Put the dragged tile where the pointer says it belongs.
	 *
	 * The tile under the pointer is found on both axes — the grid wraps, and
	 * matching on x alone would find the tile in the row above with the same
	 * column. Which side of it the dragged tile lands on is then an x question
	 * only: within a row, order runs left to right, and the row a tile ends up in
	 * is decided by how many come before it rather than by where it is dropped.
	 *
	 * A pointer in the gutter between tiles matches nothing and moves nothing,
	 * which is what stops the arrangement flickering while crossing one.
	 */
	private slideTo(x: number, y: number): void {
		const dragged = this.dragged;
		if (!dragged) return;

		const over = this.items.find((tile) => {
			if (tile === dragged) return false;
			const box = tile.getBoundingClientRect();
			return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
		});
		if (!over) return;

		const box = over.getBoundingClientRect();
		// Past the middle means it goes after, which is what makes a tile give way
		// once rather than flickering as the pointer crosses its edge.
		const after = x > box.left + box.width / 2;
		const before = after ? over.nextElementSibling : over;

		// Already there. Without this every dragover would re-run the animation
		// from a standing start and the grid would shiver.
		if (before === dragged || dragged.nextElementSibling === before) return;

		this.slide(() => this.container.insertBefore(dragged, before));
	}

	/** Run a DOM change so that everything it moves appears to travel there. */
	private slide(mutate: () => void): void {
		const before = new Map<HTMLElement, DOMRect>();
		for (const tile of this.items) before.set(tile, tile.getBoundingClientRect());

		mutate();

		const moved: HTMLElement[] = [];
		for (const tile of this.items) {
			const start = before.get(tile);
			if (!start) continue;
			const end = tile.getBoundingClientRect();
			const dx = start.left - end.left;
			const dy = start.top - end.top;
			if (!dx && !dy) continue;

			// Back to where it looked like it was, with no transition to animate
			// getting there.
			tile.setCssStyles({
				transition: "none",
				transform: `translate(${dx}px, ${dy}px)`,
			});
			moved.push(tile);
		}
		if (!moved.length) return;

		// One forced layout for all of them, so the browser has actually drawn the
		// starting position before it is asked to leave it. A frame callback would
		// do as well on paper and races the drag events in practice.
		void this.container.offsetWidth;

		for (const tile of moved) {
			// Both back to the stylesheet, which is what carries the duration.
			// An empty value clears the inline declaration rather than setting it.
			tile.setCssStyles({ transition: "", transform: "" });
		}
	}

	/**
	 * End the drag, wherever it ended.
	 *
	 * The arrangement on screen is the one committed, including when the tile was
	 * dropped outside the grid: it was arranged by dragging over the grid either
	 * way, and putting it back would throw that away.
	 */
	private finish(): void {
		const dragged = this.dragged;
		if (!dragged) return;
		this.dragged = null;
		dragged.removeClass("is-placeholder");

		const from = this.from;
		this.from = -1;

		const to = Array.prototype.indexOf.call(this.container.children, dragged);
		if (to === -1 || to === from) return;
		this.commit(from, to);
	}
}
