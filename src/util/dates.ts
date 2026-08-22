export function nowIso(): string {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return (
		`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
		`T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
	);
}

export function todayIsoDate(): string {
	return nowIso().slice(0, 10);
}

/**
 * `new Date("2026-08-21")` is UTC midnight, which lands on the previous day for
 * anyone west of UTC. A date written in a note means that day where the user is,
 * so bare dates are built in local time.
 */
export function parseDate(value: string | null | undefined): Date | null {
	if (!value) return null;
	const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
	const d = bare
		? new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3]))
		: new Date(value);
	return isNaN(d.getTime()) ? null : d;
}

/** "30d", "2w", "6h", "3m" (months), "1y" -> milliseconds. */
export function parseDuration(value: string | null | undefined): number | null {
	if (!value) return null;
	const match = /^\s*(\d+(?:\.\d+)?)\s*([hdwmy])\s*$/i.exec(value);
	if (!match) return null;
	const amount = parseFloat(match[1]);
	const hour = 3600_000;
	const unit: Record<string, number> = {
		h: hour,
		d: hour * 24,
		w: hour * 24 * 7,
		m: hour * 24 * 30,
		y: hour * 24 * 365,
	};
	return amount * unit[match[2].toLowerCase()];
}

export function formatDisplayDate(value: string | null | undefined): string {
	const d = parseDate(value);
	if (!d) return "";
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${pad(d.getDate())} ${d.toLocaleString(undefined, { month: "short" })} ${d.getFullYear()}`;
}

export function isOverdue(due: string | null | undefined): boolean {
	const d = parseDate(due);
	if (!d) return false;
	const endOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
	return endOfDay.getTime() < Date.now();
}
