/**
 * Logic regression suite for the parts of the plugin that do not touch the
 * Obsidian API. Run with `npm test`.
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { renamedPath } from "../src/util/paths";
import { orderProjects } from "../src/views/ProjectsListView/order";
import type { Project } from "../src/types";
import { join } from "node:path";
import { parseJsonc } from "../src/util/jsonc";
import {
	appendChangeLog,
	fencedSection,
	findSections,
	getFencedBlock,
	getSectionContent,
	getSectionText,
	setFencedBlock,
	setSectionFence,
	setSectionText,
	splitFrontmatter,
} from "../src/io/sections";
import { isOverdue, parseDate, parseDuration } from "../src/util/dates";
import {
	sanitizeFileName,
	slugify,
	taskFileName,
	uniqueName,
} from "../src/util/slug";
import { boardColumns, filterTasks, parentCandidates, sortTasks } from "../src/store/query";
import { classifyTags } from "../src/store/classify";
import { logValue } from "../src/util/markdown";
import {
	COLUMN_HEADERS,
	COLUMN_SORT,
	COLUMN_SORT as TABLE_SORT,
	canonicalColumns,
	normalizeColumns,
} from "../src/views/ProjectView/columnMeta";
import { buildGroups } from "../src/views/ProjectView/grouping";
import {
	DEFAULT_PROJECT_COLOR,
	PROJECT_COLOR_PRESETS,
	defaultBoardConfig,
	defaultStatuses,
} from "../src/util/defaults";
import { RESERVED_TASK_KEYS, showDescriptionDefault } from "../src/types";
import type { CustomField, Project, TableColumn, Task } from "../src/types";
import {
	applyCustomValues,
	asText,
	defaultCustomValues,
	normalizeCustomValue,
	parseCustomFieldList,
	serializeCustomFields,
} from "../src/util/customFields";

/**
 * The example notes are copied in as fixtures rather than read out of the
 * vault: the suite must not depend on anything outside the plugin folder.
 * Resolved from the bundle's own directory so the run is cwd-independent.
 */
const FIXTURES = join(__dirname, "fixtures");
let passed = 0;

function check(name: string, fn: () => void): void {
	try {
		fn();
		passed++;
		console.log(`  ok  ${name}`);
	} catch (error) {
		console.log(`FAIL  ${name}\n      ${(error as Error).message}`);
		process.exitCode = 1;
	}
}

console.log("\n--- jsonc against the Example Project Config fixture ---");
const exampleConfig = readFileSync(join(FIXTURES, "Example Project Config.md"), "utf8");
const { body: exampleBody } = splitFrontmatter(exampleConfig);

check("splits frontmatter off the example config", () => {
	assert.ok(exampleBody.startsWith("# Project Title"), exampleBody.slice(0, 40));
});

check("reads the Status Config fence despite # comments and typo'd keys", () => {
	const raw = getFencedBlock(exampleBody, "Status Config");
	assert.ok(raw, "no fenced block found");
	const parsed = parseJsonc<any>(raw);
	assert.ok(parsed, "jsonc returned null");
	const options = parsed["status-options"];
	assert.strictEqual(Object.keys(options).length, 5);
	assert.strictEqual(options["bakclog"].name, "Backlog");
	assert.strictEqual(options["complete"]["auto-stauts-change"], "30d");
});

check("hex colours inside strings survive comment stripping", () => {
	const parsed = parseJsonc<any>(getFencedBlock(exampleBody, "Status Config")!);
	assert.strictEqual(parsed["status-options"]["in-progress"].color, "#2124D");
	assert.strictEqual(parsed["status-options"]["bakclog"].color, "#FFFF");
});

check("Board Config parses even though a comment ate the separating comma", () => {
	const parsed = parseJsonc<any>(getFencedBlock(exampleBody, "Board Config")!);
	assert.ok(parsed, "board config returned null");
	assert.strictEqual(parsed["default-view"], "kandban");
	assert.strictEqual(parsed["open-tasks-in-board"], true);
});

check("comma repair does not corrupt well-formed json", () => {
	const parsed = parseJsonc<any>('{ "a": "x", "b": { "c": [1, 2] }, "d": true }');
	assert.deepStrictEqual(parsed, { a: "x", b: { c: [1, 2] }, d: true });
});

check("trailing commas are tolerated", () => {
	assert.deepStrictEqual(parseJsonc<any>('{ "a": 1, "b": [1,2,], }'), { a: 1, b: [1, 2] });
});

check("malformed json returns null rather than throwing", () => {
	assert.strictEqual(parseJsonc("{ not json"), null);
});

console.log("\n--- the projects page arrangement ---");

// Only the id is read, so a stand-in with one is the whole project here.
const proj = (id: string): Project => ({ id }) as Project;
const ids = (list: Project[]): string[] => list.map((p) => p.id);

check("projects follow the saved arrangement", () => {
	const found = [proj("alpha"), proj("beta"), proj("gamma")];
	assert.deepStrictEqual(ids(orderProjects(found, ["gamma", "alpha", "beta"])), [
		"gamma",
		"alpha",
		"beta",
	]);
});

check("a project the arrangement has never heard of still shows, at the end", () => {
	const found = [proj("alpha"), proj("beta"), proj("new")];
	assert.deepStrictEqual(ids(orderProjects(found, ["beta", "alpha"])), [
		"beta",
		"alpha",
		"new",
	]);
});

check("an arrangement naming projects that are gone drops them quietly", () => {
	const found = [proj("alpha"), proj("beta")];
	assert.deepStrictEqual(ids(orderProjects(found, ["deleted", "beta", "alpha"])), [
		"beta",
		"alpha",
	]);
});

check("no arrangement leaves the order it was given", () => {
	const found = [proj("alpha"), proj("beta")];
	assert.deepStrictEqual(ids(orderProjects(found, [])), ["alpha", "beta"]);
});

console.log("\n--- a rename moves what was inside it ---");

check("a renamed folder carries its contents to the new path", () => {
	assert.strictEqual(
		renamedPath("Work/Alpha/Alpha - Config.md", "Work", "Archive"),
		"Archive/Alpha/Alpha - Config.md"
	);
	assert.strictEqual(renamedPath("Work/Alpha", "Work", "Archive"), "Archive/Alpha");
});

check("the renamed thing itself moves", () => {
	assert.strictEqual(renamedPath("Notes.md", "Notes.md", "Journal.md"), "Journal.md");
});

check("a rename that misses returns null, a partial name match included", () => {
	assert.strictEqual(renamedPath("Workbench/A.md", "Work", "Archive"), null);
	assert.strictEqual(renamedPath("Other/A.md", "Work", "Archive"), null);
	assert.strictEqual(renamedPath(null, "Work", "Archive"), null);
});

console.log("\n--- section editing preserves surrounding prose ---");
const noteBody = [
	"# Project Title",
	"New Project",
	"",
	"# Description",
	"Prose that must survive. # not a heading",
	"",
	"# Status Config",
	"```json",
	'{ "old": true }',
	"```",
	"",
	"# Notes",
	"Keep me.",
	"",
].join("\n");

check("getSectionText pulls the right section", () => {
	assert.strictEqual(getSectionText(noteBody, "Notes"), "Keep me.");
	assert.strictEqual(getSectionText(noteBody, "Project Title"), "New Project");
});

check("setFencedBlock replaces only the fence contents", () => {
	const updated = setFencedBlock(noteBody, "Status Config", '{ "new": 1 }');
	assert.ok(updated.includes("Prose that must survive. # not a heading"));
	assert.ok(updated.includes('{ "new": 1 }'));
	assert.ok(!updated.includes('{ "old": true }'));
	assert.strictEqual(getSectionText(updated, "Notes"), "Keep me.");
});

check("setFencedBlock creates a missing section at the end", () => {
	const updated = setFencedBlock(noteBody, "Label Config", '{ "x": 1 }');
	assert.strictEqual(getFencedBlock(updated, "Label Config"), '{ "x": 1 }');
	assert.strictEqual(getSectionText(updated, "Notes"), "Keep me.");
});

check("headings inside a fence are not treated as sections", () => {
	const tricky = ["# A", "```", "# Not A Heading", "```", "# B", "b-content"].join("\n");
	assert.strictEqual(getSectionText(tricky, "B"), "b-content");
	assert.strictEqual(getSectionText(tricky, "Not A Heading"), "");
});

check("setSectionText replaces only that section's prose", () => {
	const updated = setSectionText(noteBody, "Description", "Rewritten.");
	assert.strictEqual(getSectionText(updated, "Description"), "Rewritten.");
	assert.strictEqual(getSectionText(updated, "Notes"), "Keep me.");
	assert.strictEqual(getSectionText(updated, "Project Title"), "New Project");
	assert.strictEqual(getFencedBlock(updated, "Status Config"), '{ "old": true }');
});

check("setSectionText handles multi-line text and clearing a section", () => {
	const multi = setSectionText(noteBody, "Notes", "line one\nline two");
	assert.strictEqual(getSectionText(multi, "Notes"), "line one\nline two");

	const cleared = setSectionText(noteBody, "Notes", "");
	assert.strictEqual(getSectionText(cleared, "Notes"), "");
	assert.strictEqual(
		getSectionText(cleared, "Description"),
		"Prose that must survive. # not a heading"
	);
});

check("setSectionText creates a missing section rather than dropping the text", () => {
	const updated = setSectionText(noteBody, "Change Log", "### 2026-08-22\nCreated");
	assert.strictEqual(getSectionText(updated, "Change Log"), "### 2026-08-22\nCreated");
	assert.strictEqual(getSectionText(updated, "Notes"), "Keep me.");
});

console.log("\n--- notes saved with Windows line endings ---");

// Built here rather than read from a fixture: whether the fixtures arrive with
// CRLF depends on the checkout, so a fixture cannot be relied on to exercise it.
const crlf = (text: string): string => text.replace(/\n/g, "\r\n");

check("headings are found in a note with CRLF endings", () => {
	const body = crlf("# Project Title\nMine\n\n# Description\nShort.\n");
	assert.deepStrictEqual(
		findSections(body).map((s) => s.name),
		["Project Title", "Description"]
	);
	assert.strictEqual(getSectionText(body, "Description"), "Short.");
});

check("a fenced block reads out of a CRLF note", () => {
	const body = crlf('# Status Config\n```\n{ "a": 1 }\n```\n');
	const raw = getFencedBlock(body, "Status Config");
	assert.ok(raw, "no fenced block found");
	assert.deepStrictEqual(parseJsonc(raw), { a: 1 });
});

check("a heading padded with trailing spaces still matches", () => {
	assert.deepStrictEqual(
		findSections("# Notes   \nBody\n").map((s) => s.name),
		["Notes"]
	);
});

console.log("\n--- fenced prose ---");

check("prose containing a heading does not split the note", () => {
	const written = setSectionFence(noteBody, "Description", "# Not a heading\nstill mine", "md");
	assert.strictEqual(getSectionContent(written, "Description"), "# Not a heading\nstill mine");
	// The whole point: every section after it must still be found.
	assert.strictEqual(getSectionContent(written, "Notes"), "Keep me.");
	assert.strictEqual(getFencedBlock(written, "Status Config"), '{ "old": true }');
});

check("prose containing a fence cannot close its own block", () => {
	const prose = ["before", "```js", "code();", "```", "after"].join("\n");
	const written = setSectionFence(noteBody, "Notes", prose, "md");
	assert.strictEqual(getSectionContent(written, "Notes"), prose);
	assert.strictEqual(
		getSectionContent(written, "Description"),
		"Prose that must survive. # not a heading"
	);
});

check("an unfenced section still reads, then migrates on write", () => {
	// Notes written before prose was fenced.
	assert.strictEqual(getSectionContent(noteBody, "Notes"), "Keep me.");

	const migrated = setSectionFence(noteBody, "Notes", "Keep me.", "md");
	assert.ok(migrated.includes("```md"), "expected the section to gain a fence");
	assert.strictEqual(getSectionContent(migrated, "Notes"), "Keep me.");
	// Migrating must not leave the old prose behind alongside the fence.
	assert.strictEqual(migrated.split("Keep me.").length - 1, 1);
});

check("fencedSection builds a block the reader can round-trip", () => {
	const body = fencedSection("Description", "# hi", "md").join("\n");
	assert.strictEqual(getSectionContent(body, "Description"), "# hi");

	const empty = fencedSection("Notes", "", "md").join("\n");
	assert.strictEqual(getSectionContent(empty, "Notes"), "");
});

console.log("\n--- change log ---");
const taskBody = [
	"# Description",
	"Do the thing",
	"",
	"# Notes",
	"",
	"# Change Log",
	"### 2026-08-20",
	"Status: Backlog > Upcoming",
	"",
].join("\n");

check("appends under an existing date heading", () => {
	const updated = appendChangeLog(taskBody, "2026-08-20", "Status: Upcoming > In Progress");
	assert.strictEqual(
		getSectionText(updated, "Change Log"),
		"### 2026-08-20\nStatus: Backlog > Upcoming\nStatus: Upcoming > In Progress"
	);
});

check("creates a new date heading for a new day", () => {
	const log = getSectionText(
		appendChangeLog(taskBody, "2026-08-22", "Status: Upcoming > In Progress"),
		"Change Log"
	);
	assert.ok(log.endsWith("### 2026-08-22\nStatus: Upcoming > In Progress"), log);
	assert.ok(log.includes("### 2026-08-20"));
});

check("an edit then a log append leave both sections intact", () => {
	// The order updateTask writes in: prose first, then one line per change.
	let body = setSectionText(taskBody, "Description", "Reworded the job.");
	body = appendChangeLog(body, "2026-08-22", "Status: Backlog > Upcoming");
	body = appendChangeLog(body, "2026-08-22", "Description updated");

	assert.strictEqual(getSectionText(body, "Description"), "Reworded the job.");
	const log = getSectionText(body, "Change Log");
	assert.ok(log.includes("### 2026-08-20"), log);
	assert.ok(
		log.endsWith("### 2026-08-22\nStatus: Backlog > Upcoming\nDescription updated"),
		log
	);
});

check("creates the Change Log section when absent", () => {
	const updated = appendChangeLog("# Description\nx\n", "2026-08-22", "Created");
	assert.strictEqual(getSectionText(updated, "Change Log"), "### 2026-08-22\nCreated");
	assert.strictEqual(getSectionText(updated, "Description"), "x");
});

console.log("\n--- dates & filenames ---");
check("parseDuration handles the config's 30d and friends", () => {
	assert.strictEqual(parseDuration("30d"), 30 * 86400000);
	assert.strictEqual(parseDuration("2w"), 14 * 86400000);
	assert.strictEqual(parseDuration("6h"), 6 * 3600000);
	assert.strictEqual(parseDuration(null), null);
	assert.strictEqual(parseDuration("soon"), null);
});

check("a bare date is read as local midnight, not UTC", () => {
	const d = parseDate("2026-08-21")!;
	assert.strictEqual(d.getFullYear(), 2026);
	assert.strictEqual(d.getMonth(), 7);
	assert.strictEqual(d.getDate(), 21, "date drifted across the timezone boundary");
	assert.strictEqual(d.getHours(), 0);
});

check("overdue is only true after the due day has ended, in local time", () => {
	const pad = (n: number) => String(n).padStart(2, "0");
	const localIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	assert.strictEqual(isOverdue(localIso(new Date())), false, "today is not overdue");
	assert.strictEqual(isOverdue(localIso(new Date(Date.now() - 86400000 * 2))), true);
	assert.strictEqual(isOverdue(localIso(new Date(Date.now() + 86400000 * 2))), false);
	assert.strictEqual(isOverdue(null), false);
});

check("a task file is named for the title, minus what a path cannot hold", () => {
	assert.strictEqual(taskFileName("My Task"), "My Task");
	assert.strictEqual(taskFileName("Fix the [[link]] bug?"), "Fix the link bug");
	assert.strictEqual(taskFileName("   "), "Task");
	assert.strictEqual(taskFileName("a".repeat(200)).length, 80);
});

check("a collision counts up from 2, past any number already taken", () => {
	assert.strictEqual(uniqueName("My Task", () => false), "My Task");

	const taken = new Set(["My Task"]);
	const has = (n: string): boolean => taken.has(n);
	assert.strictEqual(uniqueName("My Task", has), "My Task 2");

	taken.add("My Task 2");
	taken.add("My Task 3");
	assert.strictEqual(uniqueName("My Task", has), "My Task 4");
});

check("illegal filename characters are stripped", () => {
	assert.strictEqual(sanitizeFileName('a/b:c*d?e"f<g>h|i#j^k[l]m'), "abcdefghijklm");
	assert.strictEqual(slugify("New Project!"), "new-project");
});

console.log("\n--- change log escaping ---");

check("a value holding a tag cannot re-tag the note it is logged in", () => {
	// A task note that picks up #ProjectConfig from its own change log stops
	// being a task and becomes a phantom project.
	const logged = logValue("#ProjectConfig");
	assert.ok(logged.startsWith("`"), "a tag-bearing value must be quoted");
	assert.ok(logged.includes("#ProjectConfig"));
	assert.strictEqual(classifyTags(["ProjectTask"]), "task");
});

check("a value holding a wikilink cannot become a real backlink", () => {
	assert.strictEqual(logValue("[[Welcome#Header]]"), "`[[Welcome#Header]]`");
});

check("ordinary values are left as plain text", () => {
	assert.strictEqual(logValue("In Progress"), "In Progress");
	assert.strictEqual(logValue("Backlog"), "Backlog");
	assert.strictEqual(logValue(""), "None");
});

check("a value cannot close the code span quoting it", () => {
	const quoted = logValue("a `` b #tag");
	assert.strictEqual(quoted, "```a `` b #tag```");
});

check("a newline in a value cannot split the log entry", () => {
	assert.ok(!logValue("one\ntwo #tag").includes("\n"));
});

check("a note is only what its frontmatter says it is", () => {
	// The body's tags are deliberately not consulted; these are frontmatter.
	assert.strictEqual(classifyTags(["ProjectConfig"]), "project");
	assert.strictEqual(classifyTags(["ProjectTask"]), "task");
	assert.strictEqual(classifyTags([]), null);
});

console.log("\n--- custom fields ---");
check("custom field values are written in each type's native YAML shape", () => {
	const fields: CustomField[] = [
		{ key: "owner", name: "Owner", type: "text", defaultValue: null },
		{ key: "areas", name: "Areas", type: "list", defaultValue: null },
		{ key: "points", name: "Points", type: "number", defaultValue: null },
		{ key: "blocked", name: "Blocked", type: "checkbox", defaultValue: null },
		{ key: "ship", name: "Ship", type: "date", defaultValue: null },
	];
	const fm: Record<string, unknown> = {};
	applyCustomValues(fm, fields, {
		owner: "[[Alice]]",
		areas: ["#infra", "#api"],
		points: "5",
		blocked: true,
		ship: "2026-09-01",
	});

	// Numbers must not land as strings, or Obsidian types the property as text.
	assert.strictEqual(fm.points, 5);
	assert.strictEqual(fm.blocked, true);
	assert.deepStrictEqual(fm.areas, ["#infra", "#api"]);
	assert.strictEqual(fm.owner, "[[Alice]]");
	assert.strictEqual(fm.ship, "2026-09-01");
});

check("an empty field keeps its type rather than being typed as text", () => {
	// Obsidian reads a property's type off its value and then remembers it, so
	// an unfilled field must not land as a bare null.
	const fields: CustomField[] = [
		{ key: "owner", name: "Owner", type: "text", defaultValue: null },
		{ key: "areas", name: "Areas", type: "list", defaultValue: null },
		{ key: "blocked", name: "Blocked", type: "checkbox", defaultValue: null },
		{ key: "points", name: "Points", type: "number", defaultValue: null },
		{ key: "ship", name: "Ship", type: "date", defaultValue: null },
	];
	const fm: Record<string, unknown> = {};
	applyCustomValues(fm, fields, {});

	assert.strictEqual(fm.owner, null, "text is the type a null already implies");
	assert.deepStrictEqual(fm.areas, [], "an empty list must still read as a list");
	assert.strictEqual(fm.blocked, false, "unticked is a checkbox's empty state");
	// Neither type has an empty literal that carries it, so the key is left out
	// instead of being written as something Obsidian would call text.
	assert.ok(!("points" in fm));
	assert.ok(!("ship" in fm));
});

check("clearing a set field removes the untypeable ones from the note", () => {
	const fields: CustomField[] = [
		{ key: "owner", name: "Owner", type: "text", defaultValue: null },
		{ key: "areas", name: "Areas", type: "list", defaultValue: null },
		{ key: "points", name: "Points", type: "number", defaultValue: null },
	];
	const fm: Record<string, unknown> = { owner: "x", areas: ["y"], points: 1 };
	applyCustomValues(fm, fields, { owner: "", areas: [], points: "" });

	assert.strictEqual(fm.owner, null);
	assert.deepStrictEqual(fm.areas, []);
	assert.ok(!("points" in fm), "a stale number must not be left behind");
});

check("a number field given nonsense is dropped rather than stored as NaN", () => {
	const fm: Record<string, unknown> = { points: 3 };
	applyCustomValues(fm, [{ key: "points", name: "Points", type: "number", defaultValue: null }], {
		points: "not a number",
	});
	assert.ok(!("points" in fm));
});

check("custom fields survive a serialize/parse round trip", () => {
	// Defaults are stored in the value's own shape, not as typed-in text.
	const fields: CustomField[] = [
		{ key: "owner", name: "Owner", type: "text", defaultValue: null },
		{ key: "areas", name: "Areas", type: "list", defaultValue: ["infra", "api"] },
		{ key: "points", name: "Points", type: "number", defaultValue: 3 },
		{ key: "blocked", name: "Blocked", type: "checkbox", defaultValue: false },
	];
	const raw = parseJsonc<{ "custom-fields": unknown }>(serializeCustomFields(fields));
	assert.deepStrictEqual(parseCustomFieldList(raw?.["custom-fields"]), fields);
});

check("a field with no default contributes nothing to a new task", () => {
	const values = defaultCustomValues([
		{ key: "owner", name: "Owner", type: "text", defaultValue: null },
		{ key: "spare", name: "Spare", type: "text", defaultValue: "" },
		{ key: "none", name: "None", type: "list", defaultValue: [] },
	]);
	assert.deepStrictEqual(values, {}, "blank defaults must not write empty properties");
});

check("defaults seed a new task in each type's own shape", () => {
	const values = defaultCustomValues([
		{ key: "owner", name: "Owner", type: "text", defaultValue: "[[Alice]]" },
		{ key: "areas", name: "Areas", type: "list", defaultValue: ["infra", "api"] },
		{ key: "points", name: "Points", type: "number", defaultValue: 3 },
		{ key: "blocked", name: "Blocked", type: "checkbox", defaultValue: true },
		{ key: "open", name: "Open", type: "checkbox", defaultValue: false },
	]);

	assert.strictEqual(values.owner, "[[Alice]]");
	assert.deepStrictEqual(values.areas, ["infra", "api"]);
	assert.strictEqual(values.points, 3);
	assert.strictEqual(values.blocked, true);
	// false is a real default, not an absent one.
	assert.strictEqual(values.open, false);
});

check("a hand-written default is coerced to its field's type", () => {
	// Config notes are edited by hand, so "3" must not reach a task as a string.
	const fields = parseCustomFieldList([
		{ key: "points", name: "Points", type: "number", "default-value": "3" },
		{ key: "blocked", name: "Blocked", type: "checkbox", "default-value": "true" },
		{ key: "areas", name: "Areas", type: "list", "default-value": "infra" },
		{ key: "bad", name: "Bad", type: "number", "default-value": "not a number" },
	]);

	assert.strictEqual(fields[0].defaultValue, 3);
	assert.strictEqual(fields[1].defaultValue, true);
	assert.deepStrictEqual(fields[2].defaultValue, ["infra"]);
	assert.strictEqual(fields[3].defaultValue, null, "nonsense becomes no default");
});

check("parseCustomFieldList drops duplicates and repairs bad types", () => {
	const fields = parseCustomFieldList([
		{ key: "owner", name: "Owner", type: "text" },
		{ key: "owner", name: "Shadow", type: "number" },
		{ name: "No Key", type: "wat" },
	]);

	assert.strictEqual(fields.length, 2, "the duplicate key must be dropped");
	assert.strictEqual(fields[0].name, "Owner");
	assert.strictEqual(fields[1].key, "no-key", "a missing key is slugged from the name");
	assert.strictEqual(fields[1].type, "text", "an unknown type falls back to text");
	assert.strictEqual(fields[0].defaultValue, null, "a missing default reads as none");
});

check("a custom field may not claim a key the plugin already owns", () => {
	for (const key of ["task-status", "task-labels", "project-id", "project-file", "tags"]) {
		assert.ok(RESERVED_TASK_KEYS.has(key), `${key} must be reserved`);
	}
	assert.ok(!RESERVED_TASK_KEYS.has("estimate"), "ordinary keys stay available");
});

console.log("\n--- frontmatter that is not what the field expected ---");

check("a value YAML made an object does not stringify to [object Object]", () => {
	assert.strictEqual(asText({ a: 1 }), '{\n  "a": 1\n}');
	assert.strictEqual(asText([1, 2]), "[\n  1,\n  2\n]");
});

check("ordinary values are unchanged", () => {
	assert.strictEqual(asText("hello"), "hello");
	assert.strictEqual(asText(3), "3");
	assert.strictEqual(asText(true), "true");
	assert.strictEqual(asText(null), "");
	assert.strictEqual(asText(undefined), "");
});

check("a text field handed an object keeps the value rather than losing it", () => {
	const stored = normalizeCustomValue("text", { nested: "value" });
	assert.ok(typeof stored === "string" && stored.includes("nested"));
	assert.ok(!String(stored).includes("[object"));
});

console.log("\n--- defaults ---");
check("the shipped Backlog view filters status with no date filter", () => {
	const backlog = defaultBoardConfig().views.find((v) => v.id === "backlog");
	assert.ok(backlog, "no backlog view shipped");
	assert.strictEqual(backlog.type, "table");
	assert.deepStrictEqual(backlog.filters.status, ["backlog"]);
	assert.strictEqual(backlog.filters.date, null, "backlog must have no date filter");
	assert.strictEqual(
		backlog.groupBy,
		"none",
		"backlog is already one status, so grouping by status adds a redundant header"
	);
});

check("a description shows by default on a board and not in a table", () => {
	assert.strictEqual(showDescriptionDefault("kanban"), true);
	assert.strictEqual(showDescriptionDefault("table"), false);

	const views = defaultBoardConfig().views;
	assert.strictEqual(views.find((v) => v.id === "board")?.showDescription, true);
	assert.strictEqual(
		views.find((v) => v.id === "backlog")?.showDescription,
		false,
		"a table has no room for a second line by default"
	);
});

check("the shipped Board view is the kanban default", () => {
	const board = defaultBoardConfig();
	assert.strictEqual(board.defaultView, "board");
	assert.strictEqual(board.views.find((v) => v.id === "board")?.type, "kanban");
});

check("project colour presets are valid hex and include the default", () => {
	for (const color of PROJECT_COLOR_PRESETS) {
		assert.match(color, /^#[0-9a-f]{6}$/i, `${color} is not a 6-digit hex`);
	}
	assert.ok(PROJECT_COLOR_PRESETS.includes(DEFAULT_PROJECT_COLOR));
	assert.strictEqual(new Set(PROJECT_COLOR_PRESETS).size, PROJECT_COLOR_PRESETS.length);
});

console.log("\n--- tag classification & ignore overrides ---");
check("plain tags classify as project and task", () => {
	assert.strictEqual(classifyTags(["#ProjectConfig"]), "project");
	assert.strictEqual(classifyTags(["#ProjectTask"]), "task");
	assert.strictEqual(classifyTags(["#SomethingElse"]), null);
	assert.strictEqual(classifyTags([]), null);
});

check("the Ignore companion tag overrides its own tag", () => {
	assert.strictEqual(classifyTags(["#ProjectConfig", "#ProjectConfigIgnore"]), null);
	assert.strictEqual(classifyTags(["#ProjectTask", "#ProjectTaskIgnore"]), null);
});

check("the documented example notes classify as ignored", () => {
	const tagsOf = (file: string): string[] => {
		const frontmatter = splitFrontmatter(readFileSync(join(FIXTURES, file), "utf8")).frontmatter;
		return [...frontmatter.matchAll(/^\s+-\s+(\S+)\s*$/gm)].map((m) => `#${m[1]}`);
	};
	const configTags = tagsOf("Example Project Config.md");
	const taskTags = tagsOf("Example Task.md");

	assert.ok(configTags.includes("#ProjectConfigIgnore"), configTags.join(","));
	assert.ok(taskTags.includes("#ProjectTaskIgnore"), taskTags.join(","));
	assert.strictEqual(classifyTags(configTags), null, "example config would be indexed");
	assert.strictEqual(classifyTags(taskTags), null, "example task would be indexed");
});

check("an ignore tag alone does not make a note a project or task", () => {
	assert.strictEqual(classifyTags(["#ProjectConfigIgnore"]), null);
	assert.strictEqual(classifyTags(["#ProjectTaskIgnore"]), null);
});

check("the blanket ignore tag suppresses every kind", () => {
	assert.strictEqual(classifyTags(["#ProjectConfig", "#ProjectTrackerIgnore"]), null);
	assert.strictEqual(classifyTags(["#ProjectTask", "#ProjectTrackerIgnore"]), null);
});

check("tag matching is case-insensitive and hash-optional", () => {
	assert.strictEqual(classifyTags(["projectconfig"]), "project");
	assert.strictEqual(classifyTags(["#PROJECTTASK"]), "task");
	assert.strictEqual(classifyTags(["#ProjectTask", "#projecttaskignore"]), null);
});

check("an unrelated tag that merely starts the same is not confused", () => {
	assert.strictEqual(classifyTags(["#ProjectConfiguration"]), null);
	assert.strictEqual(classifyTags(["#ProjectTasks"]), null);
});

console.log("\n--- filtering & sorting ---");
const task = (over: Partial<Task>): Task =>
	({
		file: { path: `${over.name}.md`, basename: over.name },
		projectId: "p",
		name: "t",
		status: "backlog",
		prioritized: false,
		labels: [],
		parentPath: null,
		due: null,
		created: "2026-08-01T09:00:00",
		modified: "2026-08-01T09:00:00",
		statusModified: "2026-08-01T09:00:00",
		descriptionSnippet: "",
		...over,
	}) as Task;

const tasks = [
	task({ name: "old-backlog", status: "backlog", created: "2026-01-01T09:00:00" }),
	task({ name: "new-backlog", status: "backlog", created: "2026-08-21T09:00:00" }),
	task({ name: "doing", status: "in-progress", prioritized: true, labels: ["bug"] }),
	task({ name: "done", status: "complete", due: "2026-12-01" }),
];
const noFilters = { status: [], labels: [], prioritized: null, date: null };

check("status filter isolates the backlog (the whole point)", () => {
	const got = filterTasks(tasks, { ...noFilters, status: ["backlog"] });
	assert.deepStrictEqual(got.map((t) => t.name).sort(), ["new-backlog", "old-backlog"]);
});

check("empty status filter means every status", () => {
	assert.strictEqual(filterTasks(tasks, noFilters).length, 4);
});

check("label and prioritized filters", () => {
	assert.deepStrictEqual(
		filterTasks(tasks, { ...noFilters, labels: ["bug"] }).map((t) => t.name),
		["doing"]
	);
	assert.deepStrictEqual(
		filterTasks(tasks, { ...noFilters, prioritized: true }).map((t) => t.name),
		["doing"]
	);
});

check("relative date filter splits recent from stale", () => {
	const recent = filterTasks(tasks, {
		...noFilters,
		date: { field: "task-created", op: "within-last", value: "30d" },
	});
	assert.ok(recent.some((t) => t.name === "new-backlog"));
	assert.ok(!recent.some((t) => t.name === "old-backlog"));

	const stale = filterTasks(tasks, {
		...noFilters,
		date: { field: "task-created", op: "older-than", value: "30d" },
	});
	assert.ok(stale.some((t) => t.name === "old-backlog"));
	assert.ok(!stale.some((t) => t.name === "new-backlog"));
});

check("tasks missing the filtered date field drop out", () => {
	const withDue = filterTasks(tasks, {
		...noFilters,
		date: { field: "task-due", op: "after", value: "2026-01-01" },
	});
	assert.deepStrictEqual(
		withDue.map((t) => t.name),
		["done"]
	);
});

check("search matches title, snippet and labels", () => {
	assert.deepStrictEqual(
		filterTasks(tasks, noFilters, "doing").map((t) => t.name),
		["doing"]
	);
	assert.deepStrictEqual(
		filterTasks(tasks, noFilters, "bug").map((t) => t.name),
		["doing"]
	);
});

const order = ["backlog", "upcoming", "in-progress", "complete", "archived"];

check("sort by created date, newest first", () => {
	const got = sortTasks(tasks, { field: "task-created", dir: "desc" }, order);
	assert.strictEqual(got[0].name, "new-backlog");
	assert.strictEqual(got[got.length - 1].name, "old-backlog");
});

check("sort by status follows config key order, not alphabetical", () => {
	const got = sortTasks(tasks, { field: "task-status", dir: "asc" }, order);
	assert.deepStrictEqual(
		got.map((t) => t.status),
		["backlog", "backlog", "in-progress", "complete"]
	);
});

check("sort by labels is alphabetical, unlabelled tasks last", () => {
	const labelled = [
		task({ name: "zebra", labels: ["zzz"] }),
		task({ name: "none", labels: [] }),
		task({ name: "alpha", labels: ["aaa"] }),
	];
	assert.deepStrictEqual(
		sortTasks(labelled, { field: "task-labels", dir: "asc" }, order).map((t) => t.name),
		["alpha", "zebra", "none"]
	);
});

check("sort by priority puts prioritized tasks first when ascending", () => {
	const got = sortTasks(tasks, { field: "task-prioritized", dir: "asc" }, order);
	assert.strictEqual(got[0].name, "doing", "the only prioritized task should lead");
});

check("every column has a header label, none special-cased", () => {
	const columns = Object.keys(COLUMN_SORT) as (keyof typeof COLUMN_SORT)[];
	assert.deepStrictEqual(
		columns.sort(),
		(Object.keys(COLUMN_HEADERS) as typeof columns).sort(),
		"header and sort maps must cover exactly the same columns"
	);
	for (const column of columns) {
		assert.ok(COLUMN_HEADERS[column]?.trim(), `column "${column}" has no header text`);
	}
});

check("a view's stored column order is the order the table renders", () => {
	// The config modal drags this order, so it has to survive the round trip
	// rather than being re-sorted into a canonical one on the way out.
	assert.deepStrictEqual(normalizeColumns(["created", "title", "prioritized"]), [
		"created",
		"title",
		"prioritized",
	]);
	assert.deepStrictEqual(normalizeColumns([]), []);
});

check("a column cannot be rendered twice or under a name the build dropped", () => {
	const dirty = ["title", "title", "nonsense", "status"] as TableColumn[];
	assert.deepStrictEqual(normalizeColumns(dirty), ["title", "status"]);
});

check("the canonical order still leads with priority", () => {
	// What a view starts with before anything has been dragged.
	assert.strictEqual(canonicalColumns()[0], "prioritized");
});

check("every table column maps to a real sort field", () => {
	const fields = new Set<string>([
		"task-name",
		"task-status",
		"task-labels",
		"task-prioritized",
		"task-created",
		"task-modified",
		"task-start",
		"task-due",
	]);
	for (const column of Object.keys(COLUMN_HEADERS) as (keyof typeof COLUMN_HEADERS)[]) {
		const mapped = TABLE_SORT[column];
		assert.ok(mapped, `column "${column}" has no sort field, so its header is a dead click`);
		assert.ok(fields.has(mapped), `column "${column}" maps to unknown field ${mapped}`);
	}
});

check("a null sort field means unsorted: newest created first, stably", () => {
	const got = sortTasks(tasks, { field: null, dir: "asc" }, order);
	assert.strictEqual(got.length, tasks.length);
	assert.strictEqual(got[0].name, "new-backlog", "newest should lead");
	assert.strictEqual(got[got.length - 1].name, "old-backlog", "oldest should trail");

	// dir must not flip an unsorted list, or the direction toggle would appear to work.
	assert.deepStrictEqual(
		sortTasks(tasks, { field: null, dir: "desc" }, order).map((t) => t.name),
		got.map((t) => t.name)
	);
});

check("tasks with no due date sort last when ascending", () => {
	assert.strictEqual(sortTasks(tasks, { field: "task-due", dir: "asc" }, order)[0].name, "done");
});

console.log("\n--- board columns follow the view's status filter ---");
const boardStatuses = defaultStatuses();
const boardOrder = Object.keys(boardStatuses);

check("selected statuses become the columns", () => {
	assert.deepStrictEqual(boardColumns(boardOrder, ["upcoming", "in-progress"]), [
		"upcoming",
		"in-progress",
	]);
	assert.deepStrictEqual(boardColumns(boardOrder, ["complete"]), ["complete"]);
});

check("no status filter shows every column", () => {
	assert.deepStrictEqual(boardColumns(boardOrder, []), boardOrder);
});

check("a status the default board omits still shows when a view selects it", () => {
	assert.deepStrictEqual(boardColumns(boardOrder, ["backlog"]), ["backlog"]);
});

check("columns keep config order regardless of filter order", () => {
	assert.deepStrictEqual(boardColumns(boardOrder, ["complete", "backlog", "upcoming"]), [
		"backlog",
		"upcoming",
		"complete",
	]);
});

check("unknown statuses in a filter are ignored", () => {
	assert.deepStrictEqual(boardColumns(boardOrder, ["nope"]), []);
	assert.deepStrictEqual(boardColumns(boardOrder, ["nope", "complete"]), ["complete"]);
});

check("board columns and visible tasks agree on the same filter", () => {
	const selected = ["upcoming", "in-progress"];
	const sample = [
		task({ name: "b", status: "backlog" }),
		task({ name: "u", status: "upcoming" }),
		task({ name: "d", status: "in-progress" }),
	];
	const columns = boardColumns(boardOrder, selected);
	const visible = filterTasks(sample, { ...noFilters, status: selected });
	assert.deepStrictEqual(
		visible.map((t) => t.name).sort(),
		["d", "u"]
	);
	for (const t of visible) {
		assert.ok(columns.includes(t.status), `${t.status} has no column to sit in`);
	}
});

check("adding a new status never changes what an existing view shows", () => {
	// The reason this filter names what it wants instead of what it excludes:
	// a Backlog view must survive the project gaining statuses later.
	const before = ["backlog", "upcoming", "complete"];
	const after = [...before, "blocked", "in-review"];
	const backlogOnly = ["backlog"];

	assert.deepStrictEqual(boardColumns(before, backlogOnly), boardColumns(after, backlogOnly));

	const older = before.map((status) => task({ name: status, status }));
	const newer = after.map((status) => task({ name: status, status }));
	assert.deepStrictEqual(
		filterTasks(older, { ...noFilters, status: backlogOnly }).map((t) => t.status),
		filterTasks(newer, { ...noFilters, status: backlogOnly }).map((t) => t.status)
	);
});

check("the shipped views state their statuses as real filters", () => {
	const views = defaultBoardConfig().views;
	const board = views.find((v) => v.id === "board");
	const backlog = views.find((v) => v.id === "backlog");
	assert.ok(board && backlog, "default views missing");

	assert.deepStrictEqual(board.filters.status, ["upcoming", "in-progress", "complete"]);
	assert.deepStrictEqual(
		boardColumns(boardOrder, board.filters.status),
		["upcoming", "in-progress", "complete"],
		"the default board must render exactly the statuses its filter names"
	);
	assert.deepStrictEqual(backlog.filters.status, ["backlog"]);
});

console.log("\n--- table grouping ---");

const grouped = {
	statuses: {
		backlog: { name: "Backlog", color: "#111111", nextStatus: null, autoStatusChange: null },
		doing: { name: "Doing", color: "#222222", nextStatus: null, autoStatusChange: null },
	},
	statusOrder: ["backlog", "doing"],
	labels: {
		bug: { name: "Bug", color: "#aa0000" },
		chore: { name: "Chore", color: "#00aa00" },
	},
} as unknown as Project;

const groupTasks = [
	task({ name: "both", status: "doing", labels: ["bug", "chore"] }),
	task({ name: "bug-only", status: "backlog", labels: ["bug"] }),
	task({ name: "bare", status: "backlog", labels: [] }),
];

check("grouping by status is a partition", () => {
	const groups = buildGroups(grouped, groupTasks, "status");
	assert.deepStrictEqual(
		groups.map((g) => [g.name, g.tasks.length]),
		[
			["Backlog", 2],
			["Doing", 1],
		],
		"config order, and every task in exactly one group"
	);
	assert.strictEqual(
		groups.reduce((total, g) => total + g.tasks.length, 0),
		groupTasks.length
	);
});

check("a task with two labels is listed under both", () => {
	const groups = buildGroups(grouped, groupTasks, "label");
	const bug = groups.find((g) => g.name === "Bug");
	const chore = groups.find((g) => g.name === "Chore");
	assert.ok(bug && chore, "both label groups must render");
	assert.deepStrictEqual(bug.tasks.map((t) => t.name), ["both", "bug-only"]);
	assert.deepStrictEqual(chore.tasks.map((t) => t.name), ["both"]);
	assert.ok(
		groups.reduce((total, g) => total + g.tasks.length, 0) > groupTasks.length,
		"label grouping is not a partition: the counts are meant to exceed the task count"
	);
});

check("an unlabelled task still appears, in its own group, last", () => {
	const groups = buildGroups(grouped, groupTasks, "label");
	const last = groups[groups.length - 1];
	assert.strictEqual(last.name, "No labels");
	assert.deepStrictEqual(last.tasks.map((t) => t.name), ["bare"]);
});

check("label groups follow config order, with unknown labels after", () => {
	const stray = task({ name: "stray", status: "doing", labels: ["ghost"] });
	const groups = buildGroups(grouped, [stray, ...groupTasks], "label");
	assert.deepStrictEqual(
		groups.map((g) => g.name),
		["Bug", "Chore", "ghost", "No labels"],
		"a label the config never declared still shows its tasks rather than hiding them"
	);
});

check("an empty group is never rendered", () => {
	const groups = buildGroups(grouped, [task({ name: "solo", status: "doing", labels: ["bug"] })], "status");
	assert.deepStrictEqual(groups.map((g) => g.name), ["Doing"]);
});

console.log("\n--- parent assignment ---");

const tree = (() => {
	const root = task({ name: "root" });
	const child = task({ name: "child", parentPath: "root.md" });
	const grandchild = task({ name: "grandchild", parentPath: "child.md" });
	const other = task({ name: "other" });
	return { root, child, grandchild, other, all: [root, child, grandchild, other] };
})();

check("a task cannot be its own parent", () => {
	const names = parentCandidates(tree.all, tree.root).map((t) => t.name);
	assert.ok(!names.includes("root"));
});

check("nothing beneath a task may become its parent", () => {
	const names = parentCandidates(tree.all, tree.root).map((t) => t.name);
	assert.deepStrictEqual(
		names,
		["other"],
		"child and grandchild both descend from root, so both would close a loop"
	);
});

check("a task lower down may still be reparented upwards", () => {
	const names = parentCandidates(tree.all, tree.grandchild).map((t) => t.name);
	assert.deepStrictEqual(names.sort(), ["child", "other", "root"]);
});

check("a loop already in the data does not hang the walk", () => {
	const a = task({ name: "a", parentPath: "b.md" });
	const b = task({ name: "b", parentPath: "a.md" });
	const free = task({ name: "free" });
	assert.deepStrictEqual(
		parentCandidates([a, b, free], free)
			.map((t) => t.name)
			.sort(),
		["a", "b"],
		"neither is beneath free, and walking their cycle must terminate"
	);
});

console.log(`\n${passed} checks passed.`);
