/**
 * The config notes are hand-editable, and the examples they were modelled on use
 * `#` and `//` comments plus trailing commas. Strip those before JSON.parse.
 * String-aware, so `"color": "#FFFFFF"` survives untouched.
 */
function stripComments(input: string): string {
	let out = "";
	let inString = false;
	let escaped = false;
	let i = 0;

	while (i < input.length) {
		const ch = input[i];

		if (inString) {
			out += ch;
			if (escaped) escaped = false;
			else if (ch === "\\") escaped = true;
			else if (ch === '"') inString = false;
			i++;
			continue;
		}

		if (ch === '"') {
			inString = true;
			out += ch;
			i++;
			continue;
		}

		if (ch === "#" || (ch === "/" && input[i + 1] === "/")) {
			while (i < input.length && input[i] !== "\n") i++;
			continue;
		}

		if (ch === "/" && input[i + 1] === "*") {
			i += 2;
			while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) i++;
			i += 2;
			continue;
		}

		out += ch;
		i++;
	}

	return out;
}

function stripTrailingCommas(input: string): string {
	let out = "";
	let inString = false;
	let escaped = false;

	for (let i = 0; i < input.length; i++) {
		const ch = input[i];

		if (inString) {
			out += ch;
			if (escaped) escaped = false;
			else if (ch === "\\") escaped = true;
			else if (ch === '"') inString = false;
			continue;
		}

		if (ch === '"') {
			inString = true;
			out += ch;
			continue;
		}

		if (ch === ",") {
			let j = i + 1;
			while (j < input.length && /\s/.test(input[j])) j++;
			if (input[j] === "}" || input[j] === "]") continue;
		}

		out += ch;
	}

	return out;
}

/**
 * A comment written as `"value" # note, more note` swallows the separator comma,
 * leaving two members glued together. In valid JSON a string can never directly
 * follow a completed value, so a `"` in that position is a missing comma.
 */
function repairMissingCommas(input: string): string {
	let out = "";
	let inString = false;
	let escaped = false;
	let lastSignificant = "";

	for (let i = 0; i < input.length; i++) {
		const ch = input[i];

		if (inString) {
			out += ch;
			if (escaped) escaped = false;
			else if (ch === "\\") escaped = true;
			else if (ch === '"') {
				inString = false;
				lastSignificant = '"';
			}
			continue;
		}

		if (ch === '"') {
			if (/^["}\]]$/.test(lastSignificant) || /[A-Za-z0-9]/.test(lastSignificant)) out += ",";
			inString = true;
			out += ch;
			continue;
		}

		out += ch;
		if (!/\s/.test(ch)) lastSignificant = ch;
	}

	return out;
}

export function parseJsonc<T>(raw: string): T | null {
	const cleaned = stripTrailingCommas(stripComments(raw)).trim();
	if (!cleaned) return null;
	try {
		return JSON.parse(cleaned) as T;
	} catch {
		try {
			return JSON.parse(repairMissingCommas(cleaned)) as T;
		} catch {
			return null;
		}
	}
}

export function stringifyJson(value: unknown): string {
	return JSON.stringify(value, null, 2);
}
