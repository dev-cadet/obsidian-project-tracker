export function slugify(input: string): string {
	const slug = input
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || "project";
}

/** Obsidian/Windows reject these in file names. */
export function sanitizeFileName(input: string): string {
	return input
		.replace(/[\\/:*?"<>|#^[\]]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

export function truncate(input: string, max: number): string {
	return input.length <= max ? input : input.slice(0, max).trim();
}

/** Long enough for a real task name, short enough to keep the path openable. */
const TITLE_MAX = 80;

/**
 * The file a task is stored in, named for the task itself.
 *
 * Capped on the raw name rather than the cleaned one: stripping can only make
 * it shorter, so the path-length guarantee holds either way.
 */
export function taskFileName(name: string): string {
	return sanitizeFileName(truncate(name.trim(), TITLE_MAX)) || "Task";
}

/**
 * The first of "My Task", "My Task 2", "My Task 3"... that `taken` rejects.
 *
 * Takes a predicate rather than a folder so the counting can be tested without
 * a vault behind it.
 */
export function uniqueName(base: string, taken: (name: string) => boolean): string {
	if (!taken(base)) return base;
	let n = 2;
	while (taken(`${base} ${n}`)) n++;
	return `${base} ${n}`;
}
