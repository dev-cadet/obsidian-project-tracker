/** Characters that would make a value do something once it lands in markdown. */
const MARKDOWN_ACTIVE = /[#[\]`*_~|<>]/;

/**
 * Quotes a value bound for the Change Log. The log is markdown inside the task's
 * own note, so a value holding `#ProjectConfig` becomes a real tag on that note
 * — enough to change what Project Tracker thinks the note *is* — and one holding
 * `[[Note]]` becomes a real backlink. Inline code is inert, and the fence is
 * sized so the value cannot close it. Plain values are left alone, since most
 * are ordinary words and the log is read as text.
 */
export function logValue(value: string): string {
	// Entries are one per line, so a pasted newline would split the record.
	const text = value.replace(/\s+/g, " ").trim();
	if (!text) return "None";
	if (!MARKDOWN_ACTIVE.test(text)) return text;

	const runs = text.match(/`+/g) ?? [];
	const fence = "`".repeat(Math.max(...runs.map((run) => run.length), 0) + 1);
	// CommonMark strips one padding space per side, which is what lets a value
	// that itself starts or ends with a backtick sit inside a code span.
	const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
	return `${fence}${pad}${text}${pad}${fence}`;
}
