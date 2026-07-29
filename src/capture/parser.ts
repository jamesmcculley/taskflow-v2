import * as chrono from 'chrono-node';
import type { OrgKeyword } from '../org/keywords';
import { isOrgKeyword } from '../org/keywords';
import { parseRecurrence, repeaterFromText } from '../recurrence/recurrence';
import { todayISO } from '../store/selectors';

export interface CaptureParse {
	title: string;
	/** Leading keyword typed by the user (`NEXT call the bank`); defaults to TODO. */
	keyword: OrgKeyword;
	scheduled?: string;
	/** HH:mm when the natural-language date carried a certain hour. */
	scheduledTime?: string;
	due?: string;
	tags: string[];
	/** Raw text after `>`, resolved against project names at capture time. */
	projectQuery?: string;
	/** Org repeater (`++1w`), when the phrase maps onto one. */
	repeater?: string;
	/** rrule text kept in `:REPEAT:` for phrases no repeater expresses. */
	ruleText?: string;
	priority?: 1 | 2 | 3;
}

const DUE_TOKEN_RE = /!due\s+([^#>!]+?)\s*(?=$|#|>|!)/iu;
const PROJECT_TOKEN_RE = />\s*([^#>!]+?)\s*(?=$|#|!)/u;
const TAG_RE = /(^|\s)#([A-Za-z0-9_/-]*[A-Za-z_/-][A-Za-z0-9_/-]*)/gu;
/** `!!!`/`!!`/`!` and org's own `[#A]` cookie both set priority. */
const BANG_PRIORITY_RE = /(^|\s)(!{1,3})(?=\s|$)/;
const COOKIE_RE = /(^|\s)\[#([ABCabc])\]/;
const LEADING_KEYWORD_RE = /^\s*([A-Z]{2,12})\s+/;
const RECUR_SPAN_RE = /\bevery\s+[^#>!\n]+/i;
// rrule's fromText silently ignores trailing junk, so the phrase is bounded by
// a vocabulary check before the parser validates it.
// 'at' is deliberately absent so "every day at 9" leaves "at 9" for chrono's
// time-of-day parsing.
const RECUR_WORD_RE =
	/^(\d+|other|1st|2nd|3rd|4th|5th|last|day|days|week|weeks|weekday|weekdays|month|months|year|years|on|the|after|done|completion|mon(day)?|tue(s|sday)?|wed(nesday)?|thu(rs|rsday)?|fri(day)?|sat(urday)?|sun(day)?)$/i;

/**
 * Finds a valid "every …" recurrence phrase: consumes recurrence-vocabulary
 * words after "every", then requires the recurrence parser to accept them.
 */
function extractRecurrence(text: string): { recurrence: string; start: number; length: number } | null {
	const m = RECUR_SPAN_RE.exec(text);
	if (!m) return null;
	const words = m[0].trim().split(/\s+/);
	const kept = [words[0] ?? 'every'];
	for (const word of words.slice(1, 8)) {
		if (!RECUR_WORD_RE.test(word)) break;
		kept.push(word);
	}
	for (let len = kept.length; len >= 2; len--) {
		const candidate = kept.slice(0, len).join(' ');
		if (parseRecurrence(candidate)) {
			return { recurrence: candidate, start: m.index, length: candidate.length };
		}
	}
	return null;
}

function parseNaturalDate(text: string, ref: Date): string | undefined {
	const result = chrono.casual.parse(text, ref, { forwardDate: true })[0];
	return result ? todayISO(result.start.date()) : undefined;
}

/**
 * Parses quick-capture input: an optional leading TODO keyword, free text,
 * #tags, a natural-language scheduled date, `!due <date>`, and `>Project`.
 * Precedence: keyword, !due, >project, #tags, then the first remaining
 * natural-language date becomes the scheduled date.
 */
export function parseCapture(input: string, ref: Date = new Date()): CaptureParse {
	let text = input;

	let keyword: OrgKeyword = 'TODO';
	const km = LEADING_KEYWORD_RE.exec(text);
	if (km && isOrgKeyword(km[1] ?? '')) {
		keyword = km[1] as OrgKeyword;
		text = text.slice(km[0].length);
	}

	let due: string | undefined;
	const dueMatch = DUE_TOKEN_RE.exec(text);
	if (dueMatch) {
		due = parseNaturalDate(dueMatch[1] ?? '', ref);
		text = text.slice(0, dueMatch.index) + ' ' + text.slice(dueMatch.index + dueMatch[0].length);
	}

	let projectQuery: string | undefined;
	const projMatch = PROJECT_TOKEN_RE.exec(text);
	if (projMatch) {
		projectQuery = projMatch[1]?.trim() || undefined;
		text = text.slice(0, projMatch.index) + ' ' + text.slice(projMatch.index + projMatch[0].length);
	}

	const tags: string[] = [];
	text = text.replace(TAG_RE, (_all, pre: string, tag: string) => {
		tags.push(tag);
		return pre;
	});

	let priority: 1 | 2 | 3 | undefined;
	const cookie = COOKIE_RE.exec(text);
	if (cookie) {
		priority = ({ A: 1, B: 2, C: 3 } as const)[(cookie[2] ?? 'A').toUpperCase() as 'A' | 'B' | 'C'];
		text = text.slice(0, cookie.index) + (cookie[1] ?? '') + text.slice(cookie.index + cookie[0].length);
	} else {
		const pm = BANG_PRIORITY_RE.exec(text);
		if (pm) {
			priority = ({ '!!!': 1, '!!': 2, '!': 3 } as const)[pm[2] as '!' | '!!' | '!!!'];
			text = text.slice(0, pm.index) + (pm[1] ?? '') + text.slice(pm.index + pm[0].length);
		}
	}

	// Recurrence before chrono, so "every monday" isn't half-eaten as a date.
	let repeater: string | undefined;
	let ruleText: string | undefined;
	const rec = extractRecurrence(text);
	if (rec) {
		const org = repeaterFromText(rec.recurrence);
		if (org) repeater = `${org.kind}${org.value}${org.unit}`;
		else ruleText = rec.recurrence;
		text = text.slice(0, rec.start) + ' ' + text.slice(rec.start + rec.length);
	}

	let scheduled: string | undefined;
	let scheduledTime: string | undefined;
	const dateResult = chrono.casual.parse(text, ref, { forwardDate: true })[0];
	if (dateResult) {
		const date = dateResult.start.date();
		scheduled = todayISO(date);
		if (dateResult.start.isCertain('hour')) {
			scheduledTime = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
		}
		// Also strip a dangling connector ("on friday", "at 2026-08-01").
		let start = dateResult.index;
		const connector = /\b(?:on|at)\s+$/i.exec(text.slice(0, start));
		if (connector) start = connector.index;
		text = text.slice(0, start) + ' ' + text.slice(dateResult.index + dateResult.text.length);
	}

	// A repeat needs a stamp to hang off; org has no dateless repeater.
	if (repeater !== undefined && scheduled === undefined && due === undefined) {
		scheduled = todayISO(ref);
	}

	return {
		title: text.replace(/\s+/g, ' ').trim(),
		keyword,
		scheduled,
		scheduledTime,
		due,
		tags,
		projectQuery,
		repeater,
		ruleText,
		priority,
	};
}

/**
 * Renders a parse as the org block preview shown live in the capture modal.
 * The real insert goes through `TaskActions.renderNewTask`, which uses the
 * same serializer — this exists so the preview can't drift from what's written.
 */
export function previewCaptureBlock(parse: CaptureParse, render: (p: CaptureParse) => string[]): string {
	return render(parse).join('\n');
}
