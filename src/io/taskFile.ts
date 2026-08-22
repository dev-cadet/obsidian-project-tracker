import { App, Notice, TFile, normalizePath } from "obsidian";
import type { NewTaskInput, Project, StatusOption, Task } from "../types";
import { RESERVED_TASK_KEYS, TAG_PROJECT_TASK } from "../types";
import { formatDisplayDate, nowIso, todayIsoDate } from "../util/dates";
import { taskFileName, uniqueName } from "../util/slug";
import { logValue } from "../util/markdown";
import {
	applyCustomValues,
	asText,
	displayCustomValue,
	normalizeCustomValue,
} from "../util/customFields";
import { editFrontmatter, readFrontmatter } from "./frontmatter";
import {
	appendChangeLog,
	fencedSection,
	getSectionContent,
	setSectionFence,
	splitFrontmatter,
} from "./sections";

/** The frontmatter key holding the link to the project's config note. */
const PROJECT_LINK_KEY = "project-file";

/** The frontmatter key holding the link to the task this one belongs under. */
const PARENT_LINK_KEY = "task-parent";

/**
 * A wikilink to `target`, as written into a note that lives at `sourcePath`.
 *
 * fileToLinktext returns the shortest form that still resolves unambiguously
 * from that particular note, which is what Obsidian itself would write. A
 * wikilink specifically, because frontmatter link detection is wikilink-shaped —
 * generateMarkdownLink would emit `[text](path)` for anyone with "Use
 * [[Wikilinks]]" switched off, and that is not a link here.
 */
function wikilink(app: App, target: TFile, sourcePath: string): string {
	return `[[${app.metadataCache.fileToLinktext(target, sourcePath)}]]`;
}

/** The note a stored wikilink finds, or null when it finds nothing. */
function linkTarget(app: App, value: unknown, sourcePath: string): TFile | null {
	if (typeof value !== "string") return null;
	// Up to the first ], | or #: the alias and the subpath are not the target.
	const linkpath = /^\s*\[\[([^\]|#]+)/.exec(value)?.[1]?.trim();
	if (!linkpath) return null;
	return app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
}

/** The value written into task-parent for a chosen parent note. */
function parentValue(app: App, parentPath: string | null, taskPath: string): string {
	if (!parentPath) return "";
	const file = app.vault.getAbstractFileByPath(parentPath);
	return file instanceof TFile ? wikilink(app, file, taskPath) : "";
}

/** Prose sections are fenced as markdown: readable, but inert to the parser. */
const PROSE_LANG = "md";

/**
 * A wikilink to the project's config note, as written into a task.
 *
 * Purely a relationship: it is what puts an edge between a task and its project
 * in the graph, and what makes the property click through. project-id remains
 * the identity the store indexes on, and nothing reads this back — see
 * repairProjectLink for what happens when the two disagree.
 *
 * fileToLinktext rather than a hand-built path: it returns the shortest form
 * that still resolves unambiguously from this particular task, which is what
 * Obsidian itself would write. A wikilink specifically, because frontmatter link
 * detection is wikilink-shaped — generateMarkdownLink would emit `[text](path)`
 * for anyone with "Use [[Wikilinks]]" switched off, and that is not a link here.
 */
export function projectLink(app: App, project: Project, taskPath: string): string {
	return wikilink(app, project.configFile, taskPath);
}

/**
 * Brings a task's project link back in line with its project-id, and reports
 * whether the note had to be rewritten.
 *
 * The link is derived, so this is a repair rather than a merge: project-id
 * decides which project a task belongs to, and the link is rewritten to match
 * it. Covers a task written before the link existed, and one whose linktext no
 * longer resolves because a config note moved while Obsidian was closed.
 */
export async function repairProjectLink(app: App, project: Project, task: Task): Promise<boolean> {
	const current = readFrontmatter(app, task.file)?.[PROJECT_LINK_KEY];
	if (typeof current === "string" && resolvesTo(app, current, task.file.path, project.configFile)) {
		return false;
	}

	await editFrontmatter(app, task.file, (fm) => {
		fm[PROJECT_LINK_KEY] = projectLink(app, project, task.file.path);
	});
	return true;
}

/**
 * Whether a stored wikilink still finds the note it should.
 *
 * Resolution rather than string equality on purpose. More than one linktext
 * resolves to the same file, and Obsidian picks its own when it rewrites links
 * after a move — comparing against the canonical form would call that a fault
 * and write it back, so a moved file would be rewritten on every load forever.
 * A link that lands on the right note is left exactly as it was written.
 */
function resolvesTo(app: App, value: string, sourcePath: string, target: TFile): boolean {
	return linkTarget(app, value, sourcePath)?.path === target.path;
}

export function asDateString(value: unknown): string | null {
	if (value == null) return null;
	if (value instanceof Date) return value.toISOString().slice(0, 19);
	const text = asText(value).trim();
	return text.length ? text : null;
}

function asStringArray(value: unknown): string[] {
	if (Array.isArray(value)) return value.map((v) => asText(v).trim()).filter(Boolean);
	if (typeof value === "string") {
		return value
			.split(",")
			.map((v) => v.trim())
			.filter(Boolean);
	}
	return [];
}

function yamlScalar(value: string): string {
	return JSON.stringify(value);
}

/** Everything in the frontmatter the plugin does not own is a custom value. */
function readCustom(frontmatter: Record<string, unknown>): Record<string, unknown> {
	const custom: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(frontmatter)) {
		if (!RESERVED_TASK_KEYS.has(key)) custom[key] = value;
	}
	return custom;
}

function firstProseLine(body: string): string {
	const description = getSectionContent(body, "Description");
	for (const line of description.split("\n")) {
		const text = line.trim().replace(/^['"`]|['"`]$/g, "");
		if (text && !text.startsWith("#")) return text;
	}
	return "";
}

export function readTask(app: App, file: TFile, content: string): Task | null {
	const frontmatter = readFrontmatter(app, file);
	if (!frontmatter) return null;
	const projectId = asDateString(frontmatter["project-id"]);
	if (!projectId) return null;

	const { body } = splitFrontmatter(content);
	return {
		file,
		projectId,
		name: asDateString(frontmatter["task-name"]) ?? file.basename,
		status: asDateString(frontmatter["task-status"]) ?? "",
		prioritized: frontmatter["task-prioritized"] === true,
		labels: asStringArray(frontmatter["task-labels"]),
		parentPath: linkTarget(app, frontmatter[PARENT_LINK_KEY], file.path)?.path ?? null,
		start: asDateString(frontmatter["task-start"]),
		due: asDateString(frontmatter["task-due"]),
		created: asDateString(frontmatter["task-created"]),
		modified: asDateString(frontmatter["task-modified"]),
		statusModified:
			asDateString(frontmatter["task-status-modified"]) ??
			asDateString(frontmatter["task-modified"]),
		descriptionSnippet: firstProseLine(body),
		custom: readCustom(frontmatter),
	};
}

/**
 * Where a new task note goes. The file is named for the task itself, so two
 * tasks called the same thing sit together as "My Task" and "My Task 2".
 */
function uniquePath(app: App, folder: string, name: string): string {
	const base = uniqueName(taskFileName(name), (candidate) =>
		Boolean(app.vault.getAbstractFileByPath(normalizePath(`${folder}/${candidate}.md`)))
	);
	return normalizePath(`${folder}/${base}.md`);
}

export async function createTask(
	app: App,
	project: Project,
	input: NewTaskInput
): Promise<TFile> {
	const folderPath = normalizePath(project.tasksFolderPath);
	if (!app.vault.getAbstractFileByPath(folderPath)) {
		await app.vault.createFolder(folderPath);
	}

	const timestamp = nowIso();
	const status = project.statuses[input.status]
		? input.status
		: (project.statusOrder[0] ?? "");
	const statusName = project.statuses[status]?.name ?? status;

	// Settled before the frontmatter is built: the link is relative to where the
	// task ends up, so the path has to exist before it can be written.
	const path = uniquePath(app, folderPath, input.name);

	const frontmatter = [
		"---",
		"tags:",
		`  - ${TAG_PROJECT_TASK}`,
		`project-id: ${yamlScalar(project.id)}`,
		`${PROJECT_LINK_KEY}: ${yamlScalar(projectLink(app, project, path))}`,
		`task-name: ${yamlScalar(input.name.trim())}`,
		`task-status: ${yamlScalar(status)}`,
		`task-prioritized: ${input.prioritized}`,
		input.labels.length
			? `task-labels:\n${input.labels.map((l) => `  - ${l}`).join("\n")}`
			: "task-labels: []",
		`${PARENT_LINK_KEY}: ${yamlScalar(parentValue(app, input.parent, path))}`,
		`task-start: ${input.start ? yamlScalar(input.start) : ""}`,
		`task-due: ${input.due ? yamlScalar(input.due) : ""}`,
		`task-created: ${yamlScalar(timestamp)}`,
		`task-modified: ${yamlScalar(timestamp)}`,
		`task-status-modified: ${yamlScalar(timestamp)}`,
		"---",
	].join("\n");

	const body = [
		...fencedSection("Description", input.description.trim(), PROSE_LANG),
		"",
		...fencedSection("Notes", "", PROSE_LANG),
		"",
		"# Change Log",
		`### ${todayIsoDate()}`,
		`Created with status: ${logValue(statusName)}`,
		"",
	].join("\n");

	const file = await app.vault.create(path, `${frontmatter}\n${body}`);

	// Written through processFrontMatter so YAML typing is Obsidian's problem
	// rather than a hand-rolled serialiser's.
	if (project.customFields.length) {
		await editFrontmatter(app, file, (fm) => {
			applyCustomValues(fm, project.customFields, input.custom);
		});
	}
	return file;
}

async function touch(app: App, file: TFile): Promise<void> {
	await editFrontmatter(app, file, (fm) => {
		fm["task-modified"] = nowIso();
	});
}

export async function setTaskStatus(
	app: App,
	project: Project,
	task: Task,
	nextStatus: string
): Promise<void> {
	if (task.status === nextStatus) return;
	const label = (key: string): string => logValue(project.statuses[key]?.name ?? (key || "None"));
	const timestamp = nowIso();

	await editFrontmatter(app, task.file, (fm) => {
		fm["task-status"] = nextStatus;
		fm["task-modified"] = timestamp;
		fm["task-status-modified"] = timestamp;
	});

	await app.vault.process(task.file, (content) => {
		const { frontmatter, body } = splitFrontmatter(content);
		const entry = `Status: ${label(task.status)} > ${label(nextStatus)}`;
		const updated = appendChangeLog(body, todayIsoDate(), entry);
		return `${frontmatter}\n${updated}`;
	});
}

export async function setTaskPrioritized(
	app: App,
	task: Task,
	prioritized: boolean
): Promise<void> {
	await editFrontmatter(app, task.file, (fm) => {
		fm["task-prioritized"] = prioritized;
	});
	await touch(app, task.file);
}

export async function updateTaskFields(
	app: App,
	task: Task,
	fields: Partial<Pick<NewTaskInput, "name" | "labels" | "start" | "due">>
): Promise<void> {
	await editFrontmatter(app, task.file, (fm) => {
		if (fields.name !== undefined) fm["task-name"] = fields.name;
		if (fields.labels !== undefined) fm["task-labels"] = fields.labels;
		if (fields.start !== undefined) fm["task-start"] = fields.start ?? "";
		if (fields.due !== undefined) fm["task-due"] = fields.due ?? "";
	});
	await touch(app, task.file);
}

export interface TaskEdits {
	name: string;
	status: string;
	prioritized: boolean;
	labels: string[];
	parent: string | null;
	start: string | null;
	due: string | null;
	description: string;
	notes: string;
	custom: Record<string, unknown>;
}

/** Every field the edit modal can change, plus the prose it does not diff. */
export interface TaskEditResult {
	/** The Change Log lines written, in the order they were appended. */
	entries: string[];
	descriptionChanged: boolean;
	notesChanged: boolean;
}

function describeChanges(project: Project, task: Task, edits: TaskEdits): string[] {
	const statusName = (key: string): string =>
		logValue(project.statuses[key]?.name ?? key ?? "None");
	const labelNames = (keys: string[]): string =>
		keys.length ? keys.map((key) => logValue(project.labels[key]?.name ?? key)).join(", ") : "None";

	const entries: string[] = [];
	const name = edits.name.trim();

	if (name !== task.name) entries.push(`Title: ${logValue(task.name)} > ${logValue(name)}`);
	if (edits.status !== task.status) {
		entries.push(`Status: ${statusName(task.status)} > ${statusName(edits.status)}`);
	}
	if (edits.prioritized !== task.prioritized) {
		const word = (value: boolean): string => (value ? "Prioritized" : "Normal");
		entries.push(`Priority: ${word(task.prioritized)} > ${word(edits.prioritized)}`);
	}
	if ((edits.parent ?? "") !== (task.parentPath ?? "")) {
		const shownTask = (path: string | null): string =>
			logValue(path ? (path.split("/").pop() ?? path).replace(/\.md$/, "") : "None");
		entries.push(`Parent: ${shownTask(task.parentPath)} > ${shownTask(edits.parent)}`);
	}

	const shownDate = (value: string | null): string => formatDisplayDate(value) || "None";
	if ((edits.start ?? "") !== (task.start ?? "")) {
		entries.push(`Start: ${shownDate(task.start)} > ${shownDate(edits.start)}`);
	}
	if ((edits.due ?? "") !== (task.due ?? "")) {
		entries.push(`Due: ${shownDate(task.due)} > ${shownDate(edits.due)}`);
	}
	// Order is a presentation detail, so only membership counts as a change.
	if ([...edits.labels].sort().join(",") !== [...task.labels].sort().join(",")) {
		entries.push(`Labels: ${labelNames(task.labels)} > ${labelNames(edits.labels)}`);
	}

	for (const field of project.customFields) {
		const before = logValue(displayCustomValue(task.custom[field.key]));
		const after = logValue(
			displayCustomValue(normalizeCustomValue(field.type, edits.custom[field.key]))
		);
		if (before !== after) entries.push(`${logValue(field.name)}: ${before} > ${after}`);
	}
	return entries;
}


/**
 * Applies an edit and records what changed in the Change Log. Frontmatter goes
 * through processFrontMatter, then the body is rewritten in a single pass, so
 * the note is touched twice at most however many fields moved.
 */
export async function updateTask(
	app: App,
	project: Project,
	task: Task,
	edits: TaskEdits
): Promise<TaskEditResult> {
	const content = await app.vault.read(task.file);
	const { body: before } = splitFrontmatter(content);

	const description = edits.description.trim();
	const notes = edits.notes.trim();
	const descriptionChanged = description !== getSectionContent(before, "Description").trim();
	const notesChanged = notes !== getSectionContent(before, "Notes").trim();

	const entries = describeChanges(project, task, edits);
	if (descriptionChanged) entries.push("Description updated");
	if (notesChanged) entries.push("Notes updated");

	if (!entries.length) return { entries, descriptionChanged, notesChanged };

	const statusChanged = edits.status !== task.status;
	const timestamp = nowIso();
	await editFrontmatter(app, task.file, (fm) => {
		fm["task-name"] = edits.name.trim();
		fm["task-status"] = edits.status;
		fm["task-prioritized"] = edits.prioritized;
		fm["task-labels"] = edits.labels;
		// Removed rather than emptied. An empty task-parent is a key that still
		// reads as present to anything scanning frontmatter, and leaves the note
		// carrying a relationship it no longer has.
		const parentLink = parentValue(app, edits.parent, task.file.path);
		if (parentLink) fm[PARENT_LINK_KEY] = parentLink;
		else delete fm[PARENT_LINK_KEY];
		fm["task-start"] = edits.start ?? "";
		fm["task-due"] = edits.due ?? "";
		applyCustomValues(fm, project.customFields, edits.custom);
		fm["task-modified"] = timestamp;
		// Only a real status move restarts the auto-advance clock.
		if (statusChanged) fm["task-status-modified"] = timestamp;
	});

	// The callback is handed the current content, which is what makes this safe
	// to run straight after processFrontMatter rewrote the note: there is no
	// snapshot of our own to go stale.
	await app.vault.process(task.file, (content) => {
		const { frontmatter, body } = splitFrontmatter(content);
		let updated = body;
		if (descriptionChanged) updated = setSectionFence(updated, "Description", description, PROSE_LANG);
		if (notesChanged) updated = setSectionFence(updated, "Notes", notes, PROSE_LANG);

		const today = todayIsoDate();
		for (const entry of entries) updated = appendChangeLog(updated, today, entry);

		return `${frontmatter}\n${updated}`;
	});
	return { entries, descriptionChanged, notesChanged };
}

export function nextStatusOf(
	project: Project,
	task: Task
): { key: string; option: StatusOption } | null {
	const current = project.statuses[task.status];
	const nextKey = current?.nextStatus;
	if (!nextKey || nextKey === task.status) return null;
	const option = project.statuses[nextKey];
	if (!option) {
		new Notice(`Status "${nextKey}" is not defined in this project.`);
		return null;
	}
	return { key: nextKey, option };
}
