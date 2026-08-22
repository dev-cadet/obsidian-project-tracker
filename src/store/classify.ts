import {
	TAG_GLOBAL_IGNORE,
	TAG_IGNORE_SUFFIX,
	TAG_PROJECT_CONFIG,
	TAG_PROJECT_TASK,
} from "../types";

export type FileKind = "project" | "task" | null;

/** Tags arrive from Obsidian as "#Tag"; compare them case-insensitively without the hash. */
function normalize(tags: readonly string[]): Set<string> {
	return new Set(tags.map((tag) => tag.replace(/^#/, "").toLowerCase()));
}

function ignoreTagFor(tag: string): string {
	return `${tag}${TAG_IGNORE_SUFFIX}`;
}

/**
 * Decides what a note is to Project Tracker, purely from its tags.
 *
 * A note counts as a project or task only when it carries the matching tag and
 * neither the blanket ignore tag nor that tag's own "…Ignore" companion. Adding
 * a new recognised tag automatically gets the same override for free.
 */
export function classifyTags(tags: readonly string[]): FileKind {
	const set = normalize(tags);
	if (set.has(TAG_GLOBAL_IGNORE.toLowerCase())) return null;

	const claims = (tag: string): boolean =>
		set.has(tag.toLowerCase()) && !set.has(ignoreTagFor(tag).toLowerCase());

	if (claims(TAG_PROJECT_CONFIG)) return "project";
	if (claims(TAG_PROJECT_TASK)) return "task";
	return null;
}
