import type { CustomField, CustomFieldType } from "../types";
import { stringifyJson } from "./jsonc";
import { slugify } from "./slug";

/**
 * A value as text.
 *
 * Frontmatter holds whatever YAML can express, so a field that expects text can
 * be handed a map or a nested list. String() renders those as "[object Object]"
 * — which is then what gets shown, and what gets written back the next time the
 * task is saved, so the value is lost and the loss looks like a bug. JSON keeps
 * it readable and reversible instead.
 */
export function asText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  // Anything left is a map, a list, a Date — something with no plain rendering.
  // String() would make all of them "[object Object]"; JSON keeps the shape.
  return stringifyJson(value);
}

export const FIELD_TYPES = new Set<CustomFieldType>([
  "text",
  "list",
  "number",
  "checkbox",
  "date",
  "datetime",
]);

export function isFieldType(value: unknown): value is CustomFieldType {
  return typeof value === "string" && FIELD_TYPES.has(value as CustomFieldType);
}

export function serializeCustomFields(fields: CustomField[]): string {
  return stringifyJson({
    "custom-fields": fields.map((field) => ({
      key: field.key,
      name: field.name,
      type: field.type,
      // Always written, even null, so the key is discoverable when the
      // config note is edited by hand.
      "default-value": normalizeCustomValue(field.type, field.defaultValue),
    })),
  });
}

/**
 * Reads the `custom-fields` array out of already-parsed JSON. Split from the
 * fence handling so the shape rules stay testable without the Obsidian API.
 */
export function parseCustomFieldList(list: unknown): CustomField[] {
  if (!Array.isArray(list)) return [];

  const fields: CustomField[] = [];
  const seen = new Set<string>();

  for (const entry of list) {
    const value = entry as Record<string, unknown>;
    const name = typeof value?.name === "string" ? value.name : "";
    const key =
      typeof value?.key === "string" && value.key.trim()
        ? value.key.trim()
        : slugify(name);
    // A duplicate key would make one field silently shadow the other.
    if (!key || seen.has(key)) continue;
    seen.add(key);

    fields.push({
      key,
      name: name || key,
      type: isFieldType(value?.type) ? value.type : "text",
      defaultValue: normalizeCustomValue(
        isFieldType(value?.type) ? value.type : "text",
        value?.["default-value"],
      ),
    });
  }
  return fields;
}

/** A field's default as a value, or undefined when none is configured. */
export function parseDefaultValue(field: CustomField): unknown {
  const value = normalizeCustomValue(field.type, field.defaultValue);
  return value === null ? undefined : value;
}

/** Seeds a new task's custom values from whatever defaults are configured. */
export function defaultCustomValues(
  fields: CustomField[],
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    const value = parseDefaultValue(field);
    if (value !== undefined) values[field.key] = value;
  }
  return values;
}

/**
 * Coerces a value to the shape Obsidian's own properties editor would store for
 * that type. Anything empty becomes null, which is how Obsidian clears a
 * property — writing "" instead would leave an empty string in the YAML.
 */
export function normalizeCustomValue(
  type: CustomFieldType,
  value: unknown,
): unknown {
  // Checked before the empty guard: a checkbox has no unset state, so an
  // absent value is false rather than nothing.
  if (type === "checkbox") return value === true || value === "true";

  if (value === undefined || value === null || value === "") return null;

  if (type === "list") {
    const list = Array.isArray(value)
      ? value.map(asText).filter(Boolean)
      : [asText(value)];
    return list.length ? list : null;
  }

  if (type === "number") {
    const parsed =
      typeof value === "number" ? value : Number(asText(value).trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return asText(value);
}

/**
 * What an empty field writes into frontmatter, or undefined to leave the key
 * out. Obsidian types a property by looking at its value, so an empty one has
 * to be shaped like its own type — writing null would have every unfilled field
 * register itself as text, and the type sticks once the vault records it.
 */
function emptyValue(type: CustomFieldType): unknown {
  if (type === "list") return [];
  // A checkbox has no empty state of its own; unticked is the empty one.
  if (type === "checkbox") return false;
  if (type === "text") return null;
  // Nothing a number, date or datetime can hold says "empty, but a number".
  // The key is dropped instead, and comes back typed the moment it has one.
  return undefined;
}

/** Writes every configured field onto a frontmatter object, in place. */
export function applyCustomValues(
  fm: Record<string, unknown>,
  fields: CustomField[],
  values: Record<string, unknown>,
): void {
  for (const field of fields) {
    const value = normalizeCustomValue(field.type, values[field.key]);
    const written = value === null ? emptyValue(field.type) : value;
    if (written === undefined) delete fm[field.key];
    else fm[field.key] = written;
  }
}

/** Human-readable rendering for a Change Log entry. */
export function displayCustomValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "None";
  if (Array.isArray(value))
    return value.length ? value.map(asText).join(", ") : "None";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return asText(value);
}
