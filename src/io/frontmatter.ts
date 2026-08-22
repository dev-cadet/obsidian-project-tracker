import type { App, TFile } from "obsidian";

/**
 * A note's frontmatter, as a bag of values that have not been checked yet.
 *
 * Obsidian types `FrontMatterCache` as `{ [key: string]: any }`, and the
 * callback `processFrontMatter` hands you as `any` outright. Every key read out
 * of either is therefore `any`, which means the compiler stops asking questions
 * about it: `frontmatter["task-due"].slice(0, 10)` type-checks, and throws when
 * someone has written a date into that key as a YAML map instead of a string.
 *
 * These two wrappers are the only place that `any` is allowed to reach. Past
 * them a value is `unknown`, so it cannot be used until something has narrowed
 * it — which is what the readers below are for.
 */
export type Frontmatter = Record<string, unknown>;

/** What the metadata cache holds for a file, or null when it holds nothing. */
export function readFrontmatter(app: App, file: TFile): Frontmatter | null {
	return app.metadataCache.getFileCache(file)?.frontmatter ?? null;
}

/**
 * `processFrontMatter`, with the bag it hands the callback typed.
 *
 * Obsidian parses and re-serialises the YAML around the callback, so writing
 * through this rather than by hand is what keeps a value's type — a date, a
 * list, a checkbox — Obsidian's problem rather than a serialiser's here.
 */
export function editFrontmatter(
	app: App,
	file: TFile,
	edit: (frontmatter: Frontmatter) => void
): Promise<void> {
	return app.fileManager.processFrontMatter(file, edit);
}
