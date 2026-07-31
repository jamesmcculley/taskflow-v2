import { RRule } from 'rrule';
import type { OrgRepeater, RepeaterUnit } from '../org/timestamp';
import { addDaysISO } from '../store/selectors';

/**
 * Org repeaters, and the three kinds org distinguishes:
 *
 *   `+1w`   shift by one week from the stamp — may still land in the past, so
 *           completing a long-overdue weekly task steps forward exactly once.
 *   `++1w`  shift by whole weeks until strictly after today (catch up, stay
 *           aligned to the original weekday). This is v1's fixed-pattern rule.
 *   `.+1w`  one week from *today*, ignoring the old stamp entirely. This is
 *           v1's "after done" variant.
 *
 * v1 stored free text (`🔁 every 3rd friday`) and leaned on rrule. Org's
 * repeaters cover the regular intervals directly; anything they can't express
 * (nth-weekday-of-month, "every weekday") keeps an rrule expression in a
 * `:REPEAT:` property, evaluated by `advanceByRule` below.
 */

const REPEATER_RE = /^(\+\+|\.\+|\+)(\d+)([hdwmy])$/;

/**
 * The units this engine can actually advance. Org also has `h`, and the
 * timestamp parser reads it — a stamp carrying `++1h` must still yield its
 * date rather than failing to parse — but every date in the index is
 * day-granular, so there is nothing for an hour repeater to move. It used to
 * shift by zero days, which meant completing such a task rescheduled it to the
 * same day forever. `isAdvanceable` sends it down the "repeater we can't
 * honour" path instead, where completeTask reports it and completes once.
 */
type DateRepeaterUnit = Exclude<RepeaterUnit, 'h'>;

function isAdvanceable(r: OrgRepeater): r is OrgRepeater & { unit: DateRepeaterUnit } {
	return r.unit !== 'h';
}

export function parseRepeater(text: string): OrgRepeater | null {
	const m = REPEATER_RE.exec(text.trim());
	if (!m) return null;
	return {
		kind: m[1] as OrgRepeater['kind'],
		value: Number(m[2]),
		unit: (m[3] ?? 'd') as RepeaterUnit,
	};
}

function shift(iso: string, value: number, unit: DateRepeaterUnit): string {
	const [y, m, d] = iso.split('-').map(Number);
	const date = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
	if (unit === 'd') return addDaysISO(iso, value);
	if (unit === 'w') return addDaysISO(iso, value * 7);
	if (unit === 'y') date.setFullYear(date.getFullYear() + value);
	else date.setMonth(date.getMonth() + value);
	// Month arithmetic overflows (Jan 31 + 1m -> Mar 3); clamp to month end,
	// which is what org does and what "monthly on the 31st" has to mean.
	const target = unit === 'y' ? (m ?? 1) - 1 : ((m ?? 1) - 1 + value) % 12;
	if (date.getMonth() !== ((target % 12) + 12) % 12) date.setDate(0);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Advances one date by a repeater, per that repeater's kind. Null if the unit is sub-day. */
export function advanceDate(iso: string, repeater: OrgRepeater, today: string): string | null {
	if (!isAdvanceable(repeater)) return null;
	if (repeater.kind === '.+') return shift(today, repeater.value, repeater.unit);
	let next = shift(iso, repeater.value, repeater.unit);
	if (repeater.kind === '+') return next;
	// `++`: keep stepping until strictly after today, staying on-pattern.
	let guard = 0;
	while (next <= today && guard++ < 500) next = shift(next, repeater.value, repeater.unit);
	return next;
}

// rrule's fromText doesn't understand "every 3rd friday"; treat it
// as monthly (the common expectation), so normalize to rrule's "every month on the 3rd friday".
const ORDINAL_RE = /^every\s+(1st|2nd|3rd|4th|5th|last)\s+([a-z]+)$/i;
/** "every week after done" — anchors the next occurrence on the completion date. */
const AFTER_RE = /\s+after\s+(?:done|completion)$/i;

export function splitRecurrenceText(text: string): { base: string; afterCompletion: boolean } {
	const trimmed = text.trim();
	const m = AFTER_RE.exec(trimmed);
	return m
		? { base: trimmed.slice(0, m.index), afterCompletion: true }
		: { base: trimmed, afterCompletion: false };
}

export function normalizeRecurrenceText(text: string): string {
	const m = ORDINAL_RE.exec(text.trim());
	return m ? `every month on the ${m[1]} ${m[2]}` : text.trim();
}

export function parseRecurrence(text: string): RRule | null {
	const normalized = normalizeRecurrenceText(splitRecurrenceText(text).base);
	// fromText silently falls back to a yearly rule for unparseable input, so
	// gate on the "every …" prefix all supported phrases share.
	if (!/^every\s+\S/i.test(normalized)) return null;
	try {
		const rule = RRule.fromText(normalized);
		return Number.isFinite(rule.options.freq) ? rule : null;
	} catch {
		return null;
	}
}

/**
 * Renders an "every …" phrase as an org repeater when one can express it
 * exactly. Returns null for patterns that need the rrule fallback — the
 * migrator uses that answer to decide between a repeater and a `:REPEAT:`
 * property.
 */
export function repeaterFromText(text: string): OrgRepeater | null {
	const { base, afterCompletion } = splitRecurrenceText(text);
	const kind: OrgRepeater['kind'] = afterCompletion ? '.+' : '++';
	const m = /^every\s+(?:(\d+)\s+)?(day|days|week|weeks|month|months|year|years)$/i.exec(base.trim());
	if (m) {
		const unit = (m[2] ?? 'day').toLowerCase()[0] as RepeaterUnit;
		return { kind, value: m[1] === undefined ? 1 : Number(m[1]), unit };
	}
	if (/^every\s+other\s+week$/i.test(base.trim())) return { kind, value: 2, unit: 'w' };
	if (/^every\s+other\s+day$/i.test(base.trim())) return { kind, value: 2, unit: 'd' };
	return null;
}

function utcDate(iso: string): Date {
	const [y, m, d] = iso.split('-').map(Number);
	return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

function isoFromUTC(date: Date): string {
	return date.toISOString().slice(0, 10);
}

function diffDays(fromISO: string, toISO: string): number {
	return Math.round((utcDate(toISO).getTime() - utcDate(fromISO).getTime()) / 86400000);
}

export interface AdvanceInput {
	scheduled?: string;
	due?: string;
	/** Org repeater text (`+1w`), taken from whichever stamp carries one. */
	repeater?: string;
	/** rrule phrase from the `:REPEAT:` property, for patterns a repeater can't express. */
	ruleText?: string;
}

export interface AdvanceResult {
	scheduled?: string;
	due?: string;
}

/**
 * Computes the dates for the next occurrence of a repeating task. The
 * repeater (or `:REPEAT:` rule) drives the anchor date; when both SCHEDULED
 * and DEADLINE are present the scheduled date follows the pattern and the
 * deadline keeps its offset. Returns null when nothing parses.
 */
export function advanceRecurrence(input: AdvanceInput, today: string): AdvanceResult | null {
	const anchor = input.scheduled ?? input.due ?? today;
	let nextISO: string | null = null;

	const repeater = input.repeater === undefined ? null : parseRepeater(input.repeater);
	if (repeater) {
		nextISO = advanceDate(anchor, repeater, today);
	} else if (input.ruleText !== undefined) {
		nextISO = advanceByRule(input.ruleText, anchor, today);
	}
	if (nextISO === null) return null;

	if (input.scheduled !== undefined) {
		if (input.due !== undefined) {
			return { scheduled: nextISO, due: addDaysISO(nextISO, diffDays(input.scheduled, input.due)) };
		}
		return { scheduled: nextISO };
	}
	if (input.due !== undefined) return { due: nextISO };
	return { scheduled: nextISO };
}

/** The rrule fallback for patterns org repeaters can't express. */
export function advanceByRule(ruleText: string, anchor: string, today: string): string | null {
	const parsed = parseRecurrence(ruleText);
	if (!parsed) return null;
	const { afterCompletion } = splitRecurrenceText(ruleText);
	const from = afterCompletion ? today : anchor;
	const rule = new RRule({ ...parsed.origOptions, dtstart: utcDate(from) });
	const base = from > today ? from : today;
	const next = rule.after(utcDate(base), false);
	return next ? isoFromUTC(next) : null;
}
