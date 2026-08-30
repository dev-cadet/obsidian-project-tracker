import esbuild from "esbuild";
import process from "node:process";
// Node's own list, rather than the builtin-modules package: same content, one
// fewer dependency, and nothing to audit.
import { builtinModules as builtins } from "node:module";
import * as sass from "sass";
import { watch, writeFileSync } from "node:fs";

const production = process.argv[2] === "production";

// Obsidian loads exactly one stylesheet, by name, from the plugin folder — so
// styles.css is a build artifact here, compiled from the partials under styles/.
const SASS_ENTRY = "styles/styles.scss";
const CSS_OUT = "styles.css";

function buildCss() {
  try {
    // Expanded, never minified: themes and users read and override plugin CSS,
    // and a minified sheet is hostile to that.
    // charset:false keeps Sass from prepending @charset, which is invalid inside
    // the <style> element Obsidian injects; the document's UTF-8 already applies.
    const { css } = sass.compile(SASS_ENTRY, { style: "expanded", charset: false });
    writeFileSync(CSS_OUT, css);
    console.log(`[css] ${CSS_OUT}`);
  } catch (error) {
    // A Sass error must not take the watcher down with it — report and wait for
    // the next save.
    console.error(`[css] ${error.message}`);
  }
}

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: production,
});

buildCss();

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  // Editors fire several events per save, so coalesce them into one compile.
  // Recursive watching is unsupported on Linux; use `npx sass --watch` there.
  let pending;
  watch("styles", { recursive: true }, () => {
    clearTimeout(pending);
    pending = setTimeout(buildCss, 50);
  });
  await context.watch();
}
