import { App, TFile, TFolder, normalizePath } from "obsidian";
import type {
	BoardConfig,
	CustomField,
	LabelOption,
	Project,
	SavedView,
	SortField,
	StatusOption,
	TableColumn,
	ViewFilters,
} from "../types";
import { TAG_PROJECT_CONFIG, parseGroupBy, showDescriptionDefault } from "../types";
import { parseJsonc, stringifyJson } from "../util/jsonc";
import { parseCustomFieldList, serializeCustomFields } from "../util/customFields";
import { sanitizeFileName, slugify } from "../util/slug";
import {
	DEFAULT_PROJECT_COLOR,
	DEFAULT_PROJECT_ICON,
	defaultBoardConfig,
	defaultColumns,
	defaultLabels,
	defaultStatuses,
	emptyFilters,
} from "../util/defaults";
import {
	fencedSection,
	getFencedBlock,
	getSectionContent,
	removeSection,
	setFencedBlock,
	setSectionFence,
	splitFrontmatter,
} from "./sections";
import { editFrontmatter, readFrontmatter } from "./frontmatter";
import { asText } from "../util/customFields";

const STATUS_SECTION = "Status Config";
const LABEL_SECTION = "Label Config";
const BOARD_SECTION = "Board Config";
const FIELD_SECTION = "Custom Fields";


interface RawStatus {
	name?: string;
	color?: string;
	"next-status"?: string | null;
	"auto-status-change"?: string | null;
	"warn-start"?: boolean;
	"warn-due"?: boolean;
	/** Misspelling used by the original hand-written example configs. */
	"auto-stauts-change"?: string | null;
}

interface RawView {
	id?: string;
	name?: string;
	type?: string;
	filters?: Partial<ViewFilters>;
	"group-by"?: string;
	"show-description"?: boolean;
	sort?: { field?: string | null; dir?: string };
	columns?: string[];
}

/**
 * What a saved view is allowed to name, on the way in from the config note.
 *
 * Records keyed by the union rather than Sets of loose strings: a member added
 * to SortField or TableColumn and not listed here is a compile error, instead of
 * a value that saves to the note and then silently vanishes the next time it is
 * read. That is exactly how the Start column went missing.
 */
const SORT_FIELDS: Record<SortField, true> = {
	"task-name": true,
	"task-status": true,
	"task-labels": true,
	"task-prioritized": true,
	"task-created": true,
	"task-modified": true,
	"task-start": true,
	"task-due": true,
};

const COLUMN_KEYS: Record<TableColumn, true> = {
	prioritized: true,
	title: true,
	status: true,
	labels: true,
	start: true,
	due: true,
	created: true,
	modified: true,
};

/** Records an error when a section exists but its JSON is unusable. */
function reportUnparsed(
	errors: string[],
	section: string,
	fence: string | null,
	parsed: unknown
): void {
	if (fence !== null && fence.trim() && !parsed) {
		errors.push(`${section} is not valid JSON — falling back to defaults.`);
	}
}

function parseStatuses(
	body: string,
	errors: string[]
): {
	statuses: Record<string, StatusOption>;
	order: string[];
} {
	const fence = getFencedBlock(body, STATUS_SECTION);
	const raw = parseJsonc<{ "status-options"?: Record<string, RawStatus> }>(fence ?? "");
	reportUnparsed(errors, STATUS_SECTION, fence, raw);

	const options = raw?.["status-options"];
	if (!options || typeof options !== "object") {
		const fallback = defaultStatuses();
		return { statuses: fallback, order: Object.keys(fallback) };
	}

	const statuses: Record<string, StatusOption> = {};
	for (const [key, value] of Object.entries(options)) {
		statuses[key] = {
			name: value?.name ?? key,
			color: value?.color ?? "#6e7781",
			nextStatus: value?.["next-status"] ?? null,
			autoStatusChange:
				value?.["auto-status-change"] ?? value?.["auto-stauts-change"] ?? null,
			// A config written before these existed keeps what it did: due dates
			// warned, start dates never did. So due is an opt-out and start an
			// opt-in, and neither changes on upgrade.
			warnStart: value?.["warn-start"] === true,
			warnDue: value?.["warn-due"] !== false,
		};
	}
	return { statuses, order: Object.keys(statuses) };
}

function parseLabels(body: string, errors: string[]): Record<string, LabelOption> {
	const fence = getFencedBlock(body, LABEL_SECTION);
	const raw = parseJsonc<{ "label-options"?: Record<string, Partial<LabelOption>> }>(fence ?? "");
	reportUnparsed(errors, LABEL_SECTION, fence, raw);

	const options = raw?.["label-options"];
	if (!options || typeof options !== "object") return {};

	const labels: Record<string, LabelOption> = {};
	for (const [key, value] of Object.entries(options)) {
		labels[key] = { name: value?.name ?? key, color: value?.color ?? "#6e7781" };
	}
	return labels;
}

function parseCustomFields(body: string, errors: string[]): CustomField[] {
	const fence = getFencedBlock(body, FIELD_SECTION);
	const raw = parseJsonc<{ "custom-fields"?: unknown }>(fence ?? "");
	reportUnparsed(errors, FIELD_SECTION, fence, raw);

	return parseCustomFieldList(raw?.["custom-fields"]);
}

function parseFilters(raw: Partial<ViewFilters> | undefined): ViewFilters {
	const filters = emptyFilters();
	if (!raw) return filters;
	if (Array.isArray(raw.status)) filters.status = raw.status.map(String);
	if (Array.isArray(raw.labels)) filters.labels = raw.labels.map(String);
	if (typeof raw.prioritized === "boolean") filters.prioritized = raw.prioritized;
	if (raw.date && typeof raw.date === "object" && raw.date.field && raw.date.op) {
		filters.date = {
			field: raw.date.field,
			op: raw.date.op,
			value: String(raw.date.value ?? ""),
		};
	}
	return filters;
}

function parseView(raw: RawView, index: number): SavedView {
	const id = raw.id ?? slugify(raw.name ?? `view-${index + 1}`);
	const type = raw.type === "kanban" ? "kanban" : "table";
	const columns = (raw.columns ?? []).filter((c): c is TableColumn => c in COLUMN_KEYS);
	const sortField = raw.sort?.field;
	return {
		id,
		name: raw.name ?? id,
		type,
		filters: parseFilters(raw.filters),
		groupBy: parseGroupBy(raw["group-by"]),
		// Only an explicit boolean counts: a view saved before this existed says
		// nothing, and takes whatever its layout would have started with.
		showDescription:
			typeof raw["show-description"] === "boolean"
				? raw["show-description"]
				: showDescriptionDefault(type),
		sort: {
			// Explicit null (or "none") means unsorted; anything unrecognised
			// falls back to the default rather than silently dropping the sort.
			field:
				sortField === null || sortField === "none"
					? null
					: sortField && sortField in SORT_FIELDS
						? (sortField as SavedView["sort"]["field"])
						: "task-created",
			dir: raw.sort?.dir === "asc" ? "asc" : "desc",
		},
		columns: columns.length ? columns : defaultColumns(),
	};
}

function parseBoard(body: string, errors: string[]): BoardConfig {
	const fence = getFencedBlock(body, BOARD_SECTION);
	const raw = parseJsonc<{
		"default-view"?: string;
		"open-tasks-in-board"?: boolean;
		views?: RawView[];
	}>(fence ?? "");
	reportUnparsed(errors, BOARD_SECTION, fence, raw);

	if (!raw) return defaultBoardConfig();

	const views = Array.isArray(raw.views) ? raw.views.map(parseView) : [];
	if (!views.length) views.push(...defaultBoardConfig().views);

	const defaultView = raw["default-view"];
	return {
		defaultView: views.some((v) => v.id === defaultView)
			? (defaultView as string)
			: views[0].id,
		openTasksInBoard: raw["open-tasks-in-board"] !== false,
		views,
	};
}

export function serializeStatuses(statuses: Record<string, StatusOption>): string {
	const options: Record<string, RawStatus> = {};
	for (const [key, value] of Object.entries(statuses)) {
		options[key] = {
			name: value.name,
			color: value.color,
			"next-status": value.nextStatus,
			"auto-status-change": value.autoStatusChange,
			"warn-start": value.warnStart,
			"warn-due": value.warnDue,
		};
	}
	return stringifyJson({ "status-options": options });
}

export function serializeLabels(labels: Record<string, LabelOption>): string {
	return stringifyJson({ "label-options": labels });
}

export function serializeBoard(board: BoardConfig): string {
	return stringifyJson({
		"default-view": board.defaultView,
		"open-tasks-in-board": board.openTasksInBoard,
		views: board.views.map((view) => ({
			id: view.id,
			name: view.name,
			type: view.type,
			filters: view.filters,
			"group-by": view.groupBy,
			"show-description": view.showDescription,
			sort: view.sort,
			columns: view.columns,
		})),
	});
}

export function readProject(app: App, file: TFile, content: string): Project | null {
	const frontmatter = readFrontmatter(app, file);
	const folder = file.parent;
	if (!frontmatter || !folder) return null;

	const rawId = asText(frontmatter["project-id"]).trim();
	const id = rawId || slugify(folder.name);
	const rawColor = frontmatter["project-color"];
	const rawIcon = frontmatter["project-icon"];
	const { body } = splitFrontmatter(content);
	const configErrors: string[] = [];
	const { statuses, order } = parseStatuses(body, configErrors);

	return {
		id,
		title: getSectionContent(body, "Project Title").split("\n")[0]?.trim() || folder.name,
		description: getSectionContent(body, "Description"),
		color: typeof rawColor === "string" && rawColor.trim() ? rawColor.trim() : DEFAULT_PROJECT_COLOR,
		icon: typeof rawIcon === "string" && rawIcon.trim() ? rawIcon.trim() : DEFAULT_PROJECT_ICON,
		configFile: file,
		folder,
		tasksFolderPath: normalizePath(`${folder.path}/Tasks`),
		statuses,
		statusOrder: order,
		labels: parseLabels(body, configErrors),
		customFields: parseCustomFields(body, configErrors),
		board: parseBoard(body, configErrors),
		configErrors,
	};
}

export async function writeBoardConfig(
	app: App,
	project: Project,
	board: BoardConfig
): Promise<void> {
	await app.vault.process(project.configFile, (content) => {
		const { frontmatter, body } = splitFrontmatter(content);
		const updated = setFencedBlock(body, BOARD_SECTION, serializeBoard(board));
		return `${frontmatter}\n${updated}`;
	});
}

export interface ProjectConfigUpdate {
	title: string;
	description: string;
	statuses: Record<string, StatusOption>;
	labels: Record<string, LabelOption>;
	customFields: CustomField[];
	board: BoardConfig;
}

/**
 * Rewrites all three config blocks in one atomic pass, so a failure part way
 * through cannot leave the note describing statuses that the board config
 * disagrees with. Everything outside the fences is left byte for byte.
 */
export async function writeProjectConfig(
	app: App,
	project: Project,
	update: ProjectConfigUpdate
): Promise<void> {
	await app.vault.process(project.configFile, (content) => {
		const { frontmatter, body } = splitFrontmatter(content);
		let updated = setSectionFence(body, "Project Title", update.title, "text");
		updated = setSectionFence(updated, "Description", update.description, "md");
		// The plugin never surfaced this section. Dropping it only when it is empty
		// means a reader who did write something there does not lose it.
		if (!getSectionContent(updated, "Notes").trim()) updated = removeSection(updated, "Notes");
		updated = setFencedBlock(updated, STATUS_SECTION, serializeStatuses(update.statuses));
		updated = setFencedBlock(updated, LABEL_SECTION, serializeLabels(update.labels));
		updated = setFencedBlock(updated, FIELD_SECTION, serializeCustomFields(update.customFields));
		updated = setFencedBlock(updated, BOARD_SECTION, serializeBoard(update.board));
		return `${frontmatter}\n${updated}`;
	});
}

/** The bits of a project kept in frontmatter rather than in a config section. */
export async function writeProjectProperties(
	app: App,
	project: Project,
	values: { color: string; icon: string }
): Promise<void> {
	await editFrontmatter(app, project.configFile, (fm) => {
		fm["project-color"] = values.color;
		fm["project-icon"] = values.icon;
	});
}

export interface NewProjectInput {
	name: string;
	description: string;
	color: string;
	icon: string;
	folder: TFolder;
	statuses: Record<string, StatusOption>;
}

export async function createProject(
	app: App,
	input: NewProjectInput
): Promise<{ configFile: TFile; projectId: string }> {
	const projectId = slugify(input.name);
	const statuses = Object.keys(input.statuses).length ? input.statuses : defaultStatuses();

	const content = [
		"---",
		"tags:",
		`  - ${TAG_PROJECT_CONFIG}`,
		`project-id: ${JSON.stringify(projectId)}`,
		`project-color: ${JSON.stringify(input.color || DEFAULT_PROJECT_COLOR)}`,
		`project-icon: ${JSON.stringify(input.icon || DEFAULT_PROJECT_ICON)}`,
		"---",
		...fencedSection("Project Title", input.name.trim(), "text"),
		"",
		...fencedSection("Description", input.description.trim(), "md"),
		"",
		`# ${STATUS_SECTION}`,
		"```json",
		serializeStatuses(statuses),
		"```",
		"",
		`# ${LABEL_SECTION}`,
		"```json",
		serializeLabels(defaultLabels()),
		"```",
		"",
		`# ${FIELD_SECTION}`,
		"```json",
		serializeCustomFields([]),
		"```",
		"",
		`# ${BOARD_SECTION}`,
		"```json",
		serializeBoard(defaultBoardConfig()),
		"```",
		"",
	].join("\n");

	const safeName = sanitizeFileName(input.name) || "Project";
	const configPath = normalizePath(`${input.folder.path}/${safeName} - Config.md`);
	const configFile = await app.vault.create(configPath, content);
	await app.vault.createFolder(normalizePath(`${input.folder.path}/Tasks`));
	return { configFile, projectId };
}
