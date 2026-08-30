/**
 * Writes a release version into every file that carries one.
 *
 * The community directory validates `manifest.json` at the default branch's
 * HEAD, and the app installs from the GitHub release — so the version has to
 * agree in the repository and on the tag. One script writing all four files is
 * what stops them drifting, which they already had: package.json sat at 0.1.0
 * while the manifest said 1.0.0.
 *
 * Run by the release workflow, not by hand.
 */
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
	console.error(
		`Not a version: ${JSON.stringify(version)}. Expected x.y.z, with no "v" prefix.`
	);
	process.exit(1);
}

/**
 * Rewrite a JSON file in place, keeping the indentation and final newline it
 * already had. These four files disagree about both, and a release should not
 * carry a reformatting diff.
 */
function edit(path, change) {
	const text = readFileSync(path, "utf8");
	const indent = /\n([\t ]+)/.exec(text)?.[1] ?? "\t";
	const value = JSON.parse(text);
	change(value);
	writeFileSync(
		path,
		JSON.stringify(value, null, indent) + (text.endsWith("\n") ? "\n" : "")
	);
}

edit("package.json", (pkg) => {
	pkg.version = version;
});

// npm refuses to `ci` when the lockfile disagrees with package.json, and
// building with `npm ci` is what makes the release reproducible for the review.
edit("package-lock.json", (lock) => {
	lock.version = version;
	if (lock.packages?.[""]) lock.packages[""].version = version;
});

let minAppVersion;
edit("manifest.json", (manifest) => {
	minAppVersion = manifest.minAppVersion;
	manifest.version = version;
});

// Maps each plugin version to the oldest app that can load it, so someone on an
// older app is offered the newest release that still runs for them.
edit("versions.json", (versions) => {
	versions[version] = minAppVersion;
});

console.log(`${version} (minAppVersion ${minAppVersion})`);
