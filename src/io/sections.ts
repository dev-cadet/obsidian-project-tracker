export interface SectionRange {
	name: string;
	level: number;
	/** Index of the heading line itself. */
	headingLine: number;
	/** First line of the section body. */
	start: number;
	/** Exclusive end of the section body. */
	end: number;
}

// `.` does not match a carriage return — it is a line terminator in JS — and `$`
// without the m flag only matches the very end of the string. So on a note saved
// with CRLF endings this pattern failed on every heading, not merely on the last,
// and a config note read as having no sections at all. Trailing whitespace is
// consumed explicitly instead, which also covers a heading padded with spaces.
const HEADING = /^(#{1,6})\s+(.*?)\s*$/;
const FENCE = /^\s*(`{3,}|~{3,})/;

interface FenceToken {
	char: string;
	length: number;
}

function fenceToken(line: string): FenceToken | null {
	const match = FENCE.exec(line);
	if (!match) return null;
	return { char: match[1][0], length: match[1].length };
}

/**
 * CommonMark closes a fence only on the same character, at least as long as the
 * opener. Comparing lengths is what lets a block hold text that itself contains
 * ``` without ending early.
 */
function closesFence(open: FenceToken, token: FenceToken): boolean {
	return token.char === open.char && token.length >= open.length;
}

/** A fence long enough that nothing in `text` can close it. */
function fenceFor(text: string): string {
	let longest = 0;
	for (const line of text.split("\n")) {
		const token = fenceToken(line);
		if (token?.char === "`") longest = Math.max(longest, token.length);
	}
	return "`".repeat(Math.max(3, longest + 1));
}

export function splitFrontmatter(content: string): { frontmatter: string; body: string } {
	if (!content.startsWith("---")) return { frontmatter: "", body: content };
	const lines = content.split("\n");
	for (let i = 1; i < lines.length; i++) {
		if (lines[i].trim() === "---") {
			return {
				frontmatter: lines.slice(0, i + 1).join("\n"),
				body: lines.slice(i + 1).join("\n"),
			};
		}
	}
	return { frontmatter: "", body: content };
}

/** Heading scan that ignores anything inside a fenced code block. */
export function findSections(body: string): SectionRange[] {
	const lines = body.split("\n");
	const sections: SectionRange[] = [];
	let fence: FenceToken | null = null;

	for (let i = 0; i < lines.length; i++) {
		const token = fenceToken(lines[i]);
		if (token) {
			if (fence === null) fence = token;
			else if (closesFence(fence, token)) fence = null;
			continue;
		}
		if (fence !== null) continue;

		const headingMatch = HEADING.exec(lines[i]);
		if (!headingMatch) continue;

		const level = headingMatch[1].length;
		for (let j = sections.length - 1; j >= 0; j--) {
			if (sections[j].end === -1 && sections[j].level >= level) sections[j].end = i;
		}
		sections.push({
			name: headingMatch[2].trim(),
			level,
			headingLine: i,
			start: i + 1,
			end: -1,
		});
	}

	for (const section of sections) {
		if (section.end === -1) section.end = lines.length;
	}
	return sections;
}

export function findSection(body: string, name: string, level = 1): SectionRange | null {
	const target = name.trim().toLowerCase();
	return (
		findSections(body).find(
			(s) => s.level === level && s.name.toLowerCase() === target
		) ?? null
	);
}

export function getSectionText(body: string, name: string, level = 1): string {
	const section = findSection(body, name, level);
	if (!section) return "";
	return body.split("\n").slice(section.start, section.end).join("\n").trim();
}

/** Range of the lines *inside* the first fenced block of a section. */
function findFenceContent(
	lines: string[],
	section: SectionRange
): { open: number; contentStart: number; contentEnd: number } | null {
	for (let i = section.start; i < section.end; i++) {
		const open = fenceToken(lines[i]);
		if (!open) continue;
		for (let j = i + 1; j < section.end; j++) {
			const close = fenceToken(lines[j]);
			if (close && closesFence(open, close)) {
				return { open: i, contentStart: i + 1, contentEnd: j };
			}
		}
		return null;
	}
	return null;
}

export function getFencedBlock(body: string, sectionName: string): string | null {
	const section = findSection(body, sectionName);
	if (!section) return null;
	const lines = body.split("\n");
	const fence = findFenceContent(lines, section);
	if (!fence) return null;
	return lines.slice(fence.contentStart, fence.contentEnd).join("\n");
}

/**
 * Replace the contents of a section's fenced block, leaving every other byte of
 * the note alone. Creates the section (and fence) at the end if it's missing.
 */
export function setFencedBlock(
	body: string,
	sectionName: string,
	contents: string,
	language = "json"
): string {
	const section = findSection(body, sectionName);
	const lines = body.split("\n");

	if (section) {
		const fence = findFenceContent(lines, section);
		if (fence) {
			lines.splice(
				fence.contentStart,
				fence.contentEnd - fence.contentStart,
				...contents.split("\n")
			);
			return lines.join("\n");
		}
		lines.splice(section.end, 0, "```" + language, ...contents.split("\n"), "```");
		return lines.join("\n");
	}

	const trimmed = body.replace(/\s+$/, "");
	return `${trimmed}\n\n# ${sectionName}\n\`\`\`${language}\n${contents}\n\`\`\`\n`;
}

/**
 * A prose section's content. Prose is stored fenced so that a line the reader
 * typed — `# Heading`, `---`, a list of `#tags` — is text rather than structure.
 * Falls back to the raw section for notes written before that was true.
 */
export function getSectionContent(body: string, name: string): string {
	const fenced = getFencedBlock(body, name);
	return fenced === null ? getSectionText(body, name) : fenced;
}

/** The lines of a fenced section, for building a note from scratch. */
export function fencedSection(name: string, text: string, language: string): string[] {
	const fence = fenceFor(text);
	const open = `${fence}${language}`;
	return text ? [`# ${name}`, open, ...text.split("\n"), fence] : [`# ${name}`, open, fence];
}

/**
 * Replace a prose section with a fenced block, leaving every other section
 * alone. Replaces the whole body rather than the fence's contents, so a section
 * written before prose was fenced is migrated in place on the first save.
 */
export function setSectionFence(
	body: string,
	sectionName: string,
	text: string,
	language: string
): string {
	const [, ...block] = fencedSection(sectionName, text, language);
	const section = findSection(body, sectionName);

	if (!section) {
		const trimmed = body.replace(/\s+$/, "");
		return `${trimmed}\n\n# ${sectionName}\n${block.join("\n")}\n`;
	}

	const lines = body.split("\n");
	// The trailing blank keeps a gap before whatever heading follows.
	lines.splice(section.start, section.end - section.start, ...block, "");
	return lines.join("\n");
}

/** Drops a section along with its heading. A no-op when it is not there. */
export function removeSection(body: string, name: string, level = 1): string {
	const section = findSection(body, name, level);
	if (!section) return body;
	const lines = body.split("\n");
	lines.splice(section.headingLine, section.end - section.headingLine);
	return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

/**
 * Replace a section's body, leaving its heading and every other section alone.
 * Creates the section at the end when it is missing.
 */
export function setSectionText(body: string, sectionName: string, text: string): string {
	const section = findSection(body, sectionName);
	if (!section) {
		const trimmed = body.replace(/\s+$/, "");
		return `${trimmed}\n\n# ${sectionName}\n${text}\n`;
	}

	const lines = body.split("\n");
	// The trailing blank keeps a gap before whatever heading follows.
	const replacement = text ? [...text.split("\n"), ""] : [""];
	lines.splice(section.start, section.end - section.start, ...replacement);
	return lines.join("\n");
}

/** Append lines to the end of a section, creating it if absent. */
export function appendToSection(body: string, sectionName: string, text: string): string {
	const section = findSection(body, sectionName);
	if (!section) {
		const trimmed = body.replace(/\s+$/, "");
		return `${trimmed}\n\n# ${sectionName}\n${text}\n`;
	}

	const lines = body.split("\n");
	let insertAt = section.end;
	while (insertAt > section.start && lines[insertAt - 1].trim() === "") insertAt--;
	lines.splice(insertAt, 0, ...text.split("\n"));
	return lines.join("\n");
}

/**
 * Append a change-log line under today's `### YYYY-MM-DD` sub-heading inside
 * `# Change Log`, reusing the heading when one already exists for today.
 */
export function appendChangeLog(body: string, isoDate: string, entry: string): string {
	const changeLog = findSection(body, "Change Log");
	if (!changeLog) {
		const trimmed = body.replace(/\s+$/, "");
		return `${trimmed}\n\n# Change Log\n### ${isoDate}\n${entry}\n`;
	}

	const lines = body.split("\n");
	const dateHeading = findSections(body).find(
		(s) =>
			s.level === 3 &&
			s.name.trim() === isoDate &&
			s.headingLine > changeLog.headingLine &&
			s.headingLine < changeLog.end
	);

	if (dateHeading) {
		let insertAt = dateHeading.end;
		while (insertAt > dateHeading.start && lines[insertAt - 1].trim() === "") insertAt--;
		lines.splice(insertAt, 0, entry);
		return lines.join("\n");
	}

	let insertAt = changeLog.end;
	while (insertAt > changeLog.start && lines[insertAt - 1].trim() === "") insertAt--;
	lines.splice(insertAt, 0, `### ${isoDate}`, entry);
	return lines.join("\n");
}
