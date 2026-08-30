import { App, PluginSettingTab } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
import type ProjectTrackerPlugin from "./main";
import type { StatusOption } from "./types";
import { defaultStatuses } from "./util/defaults";
import { serializeStatuses } from "./io/projectFile";
import { parseJsonc } from "./util/jsonc";

export interface ProjectTrackerSettings {
	defaultProjectsFolder: string;
	autoStatusChange: boolean;
	repairProjectLinks: boolean;
	openTaskAfterCreate: boolean;
	/**
	 * Whether opening a project reuses the project page already in the main area
	 * rather than adding a tab beside it. A project already open is revealed
	 * either way — this only decides what happens to a *different* one.
	 */
	replaceProjectPages: boolean;
	/** The Statuses section's advanced rows. A dialog preference, not a project one. */
	showAdvancedStatuses: boolean;
	/**
	 * Project ids, in the order the projects page shows them. Empty until
	 * something is dragged, which reads as "however the store sorted them".
	 */
	projectOrder: string[];
	statusTemplate: string;
}

export const DEFAULT_SETTINGS: ProjectTrackerSettings = {
	defaultProjectsFolder: "",
	autoStatusChange: true,
	repairProjectLinks: true,
	openTaskAfterCreate: false,
	replaceProjectPages: true,
	showAdvancedStatuses: false,
	projectOrder: [],
	statusTemplate: serializeStatuses(defaultStatuses()),
};

export function templateStatuses(settings: ProjectTrackerSettings): Record<string, StatusOption> {
	const parsed = parseJsonc<{ "status-options"?: Record<string, unknown> }>(
		settings.statusTemplate
	);
	if (!parsed?.["status-options"]) return defaultStatuses();

	const statuses: Record<string, StatusOption> = {};
	for (const [key, raw] of Object.entries(parsed["status-options"])) {
		const value = raw as Record<string, unknown>;
		statuses[key] = {
			name: typeof value.name === "string" ? value.name : key,
			color: typeof value.color === "string" ? value.color : "#6e7781",
			nextStatus: typeof value["next-status"] === "string" ? value["next-status"] : null,
			autoStatusChange:
				typeof value["auto-status-change"] === "string" ? value["auto-status-change"] : null,
			warnStart: value["warn-start"] === true,
			warnDue: value["warn-due"] !== false,
		};
	}
	return Object.keys(statuses).length ? statuses : defaultStatuses();
}

/**
 * The plugin's settings tab.
 *
 * Declared rather than drawn. `display()` has been deprecated since 1.13.0 in
 * favour of `getSettingDefinitions()`, and the reason is not tidiness: Obsidian
 * reads these definitions to put each setting into its own global settings
 * search. A tab that draws itself imperatively is a tab whose settings cannot
 * be found from anywhere but the tab.
 *
 * Reading and writing come free — the base class reads `plugin.settings` by the
 * `key` on each control — so only the write side is overridden below, and only
 * to keep one promise the default breaks.
 */
export class ProjectTrackerSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: ProjectTrackerPlugin
	) {
		super(app, plugin);
	}

	/**
	 * The default writes `plugin.settings` and then calls `plugin.saveData`
	 * directly, which skips saveSettings and so skips the listeners it notifies.
	 * Nothing in this tab is drawn by a view today, but a setting that quietly
	 * stopped reaching them would be a difficult thing to notice later.
	 */
	setControlValue(key: string, value: unknown): Promise<void> {
		Object.assign(this.plugin.settings, { [key]: value });
		return this.plugin.saveSettings();
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: "Default folder for new projects",
				desc: "Pre-filled in the new project dialog. Leave blank for the vault root.",
				// A folder control rather than a text box: the app browses the vault
				// for it, so a typo cannot become a folder nobody meant to make.
				control: {
					type: "folder",
					key: "defaultProjectsFolder",
					placeholder: "Projects",
					includeRoot: true,
				},
			},
			{
				name: "Open new tasks in the editor",
				desc: "Off keeps you on the board after creating a task.",
				control: { type: "toggle", key: "openTaskAfterCreate" },
			},
			{
				name: "Replace existing project pages",
				desc: "Replace any open project page when opening another project.",
				control: { type: "toggle", key: "replaceProjectPages" },
			},
			{
				name: "Run timed status changes",
				desc: "Advance tasks to their next status once they have sat in a status longer than its auto-status-change duration.",
				aliases: ["auto status change", "schedule"],
				control: { type: "toggle", key: "autoStatusChange" },
			},
			{
				name: "Keep project links up to date",
				desc: "On startup, automatically repair broken project file references in tasks.",
				control: { type: "toggle", key: "repairProjectLinks" },
			},
			{
				type: "group",
				heading: "Leaflets",
				items: [
					{
						name: "Task column",
						desc: "Docks a panel listing one status of one project. Each panel keeps its own project, status and card settings, so the button opens another one every time.",
						// Rendered rather than declared as an action: an action row is the
						// whole row, and this is a button on a row that explains itself.
						render: (setting) => {
							setting.addButton((button) =>
								button
									.setButtonText("Open")
									.setCta()
									.onClick(() => void this.plugin.openTaskColumn())
							);
						},
					},
					{
						name: "Projects browser",
						desc: "Docks the projects list in the sidebar. There is nothing to configure per panel, so this reveals the one that is already open rather than adding another.",
						render: (setting) => {
							setting.addButton((button) =>
								button
									.setButtonText("Open")
									.setCta()
									.onClick(() => void this.plugin.openProjectsLeaflet())
							);
						},
					},
				],
			},
			{
				type: "group",
				heading: "Status template for new projects",
				// A handle for the stylesheet: the editor below is JSON, and JSON is
				// read in a monospace face.
				cls: "pt-status-template",
				extraButtons: [
					(button) =>
						button
							.setIcon("rotate-ccw")
							.setTooltip("Reset to defaults")
							.onClick(() => {
								void this.setControlValue(
									"statusTemplate",
									serializeStatuses(defaultStatuses())
								).then(() => this.update());
							}),
				],
				items: [
					{
						name: "Template",
						desc: "JSON written into the status config section whenever a project is created.",
						control: {
							type: "textarea",
							key: "statusTemplate",
							rows: 18,
							// The tab refuses the value and says why, in place. This used to
							// be a notice that appeared after the fact and left the invalid
							// text sitting in the box looking saved.
							validate: (value) =>
								parseJsonc(value) ? undefined : "Not valid JSON.",
						},
					},
				],
			},
		];
	}
}
