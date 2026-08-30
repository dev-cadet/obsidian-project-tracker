import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

/**
 * Obsidian's own rule set, run locally as the closest proxy to the automated
 * review the marketplace applies on submission. It is not the same runner, so a
 * clean pass here is not a guarantee — release assets, manifest/version
 * matching and security scanning are only checked on the submission PR.
 */
export default defineConfig([
	{
		// tests/ is outside tsconfig's `include`, so the type-aware rules cannot
		// parse it. It is not shipped in the bundle either, so nothing is lost.
		//
		// esbuild.config.mjs is the build itself: it runs in Node, before there is
		// an Obsidian to be compatible with, so the rules about Node built-ins and
		// window-scoped timers are asking it to be something it is not.
		ignores: [
			"main.js",
			"tests/**",
			"node_modules/**",
			"esbuild.config.mjs",
			"version-bump.mjs",
			"tmp/**",
		],
	},
	...obsidianmd.configs.recommended,
	{
		files: ["**/*.ts"],
		languageOptions: {
			parser: tsparser,
			parserOptions: { project: "./tsconfig.json" },
		},
		rules: {
			// This plugin was never generated from the sample template.
			"obsidianmd/sample-names": "off",
		},
	},
]);
