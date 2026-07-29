/**
 * Org timestamps: `<2026-07-21 Tue>`, `<2026-07-21 Tue 09:30>`, with an
 * optional repeater (`+1w`, `++1w`, `.+1w`) and an optional end time
 * (`09:30-10:15`). Angle brackets mean "active" (agenda-visible); square
 * brackets mean "inactive" — CLOSED stamps and log entries use those.
 */

export type RepeaterKind = '+' | '++' | '.+';
export type RepeaterUnit = 'h' | 'd' | 'w' | 'm' | 'y';

export interface OrgRepeater {
	kind: RepeaterKind;
	value: number;
	unit: RepeaterUnit;
}

export interface OrgTimestamp {
	/** ISO date, `YYYY-MM-DD`. */
	date: string;
	/** `HH:mm` when the timestamp carries a time. */
	time?: string;
	/** `HH:mm` end of a time range (`09:30-10:15`). */
	endTime?: string;
	repeater?: OrgRepeater;
	/** false for `[…]` inactive timestamps. */
	active: boolean;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const BODY =
	'(\\d{4}-\\d{2}-\\d{2})' + // date
	'(?:\\s+[A-Za-z]{3,})?' + // day name (written by us, ignored on read)
	'(?:\\s+(\\d{1,2}:\\d{2})(?:-(\\d{1,2}:\\d{2}))?)?' + // time / time range
	'(?:\\s+(\\+\\+|\\.\\+|\\+)(\\d+)([hdwmy]))?'; // repeater

const ACTIVE_RE = new RegExp(`<${BODY}\\s*>`);
const INACTIVE_RE = new RegExp(`\\[${BODY}\\s*\\]`);
/** Either bracket style, for scanning a line for any timestamp. */
export const ANY_TIMESTAMP_RE = new RegExp(`<${BODY}\\s*>|\\[${BODY}\\s*\\]`, 'g');

function build(m: RegExpExecArray, active: boolean): OrgTimestamp {
	const repeaterKind = m[4] as RepeaterKind | undefined;
	return {
		date: m[1] ?? '',
		time: m[2] === undefined ? undefined : normalizeTime(m[2]),
		endTime: m[3] === undefined ? undefined : normalizeTime(m[3]),
		repeater:
			repeaterKind === undefined
				? undefined
				: { kind: repeaterKind, value: Number(m[5]), unit: (m[6] ?? 'd') as RepeaterUnit },
		active,
	};
}

/** Parses a single timestamp; the string may contain surrounding text. */
export function parseTimestamp(text: string): OrgTimestamp | null {
	const active = ACTIVE_RE.exec(text);
	if (active) return build(active, true);
	const inactive = INACTIVE_RE.exec(text);
	if (inactive) return build(inactive, false);
	return null;
}

export function normalizeTime(time: string): string {
	const [h, m] = time.split(':');
	return `${(h ?? '0').padStart(2, '0')}:${m ?? '00'}`;
}

/** The three-letter day name org writes into every timestamp. */
export function dayName(dateISO: string): string {
	const [y, m, d] = dateISO.split('-').map(Number);
	return DOW[new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getDay()] ?? 'Mon';
}

export function formatRepeater(r: OrgRepeater): string {
	return `${r.kind}${r.value}${r.unit}`;
}

export function formatTimestamp(ts: OrgTimestamp): string {
	let inner = `${ts.date} ${dayName(ts.date)}`;
	if (ts.time !== undefined) {
		inner += ` ${ts.time}`;
		if (ts.endTime !== undefined) inner += `-${ts.endTime}`;
	}
	if (ts.repeater) inner += ` ${formatRepeater(ts.repeater)}`;
	return ts.active ? `<${inner}>` : `[${inner}]`;
}

/** An active timestamp for a plain date (+ optional time), the common case. */
export function timestamp(dateISO: string, time?: string, repeater?: OrgRepeater): OrgTimestamp {
	return { date: dateISO, time, repeater, active: true };
}

/** The inactive stamp CLOSED: uses — always dated *and* timed, as org writes it. */
export function inactiveStamp(dateISO: string, time: string): OrgTimestamp {
	return { date: dateISO, time, active: false };
}

/** Splits an ISO datetime into the local date + `HH:mm` an org stamp needs. */
export function splitISODateTime(isoDateTime: string): { date: string; time: string } {
	const d = new Date(isoDateTime);
	const pad = (n: number) => String(n).padStart(2, '0');
	return {
		date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
		time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
	};
}
