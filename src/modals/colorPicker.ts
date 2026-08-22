/** <input type="color"> silently resets anything that is not 6-digit hex. */
const HEX6 = /^#[0-9a-f]{6}$/i;

/**
 * A single swatch showing `value`, opening the OS picker when clicked. Every
 * colour in the plugin is picked this way — one status, label or project per
 * line, where a row of presets would drown the thing being coloured.
 */
export function renderColorDot(
  parent: HTMLElement,
  value: string,
  onChange: (color: string) => void,
): void {
  const dot = parent.createSpan({ cls: "pt-color-dot" });
  dot.style.setProperty("--pt-swatch-color", value);

  const input = dot.createEl("input", {
    attr: { type: "color", "aria-label": "Colour" },
  });
  if (HEX6.test(value.trim())) input.value = value.trim().toLowerCase();

  input.addEventListener("input", () => {
    dot.style.setProperty("--pt-swatch-color", input.value);
    onChange(input.value);
  });
}
