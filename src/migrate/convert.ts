import { REPEAT_PROPERTY, TONIGHT_TAG } from '../org/tags';
import { priorityFromRank } from '../org/keywords';
import type { OrgKeyword } from '../org/keywords';
import type { OrgTask } from '../org/parser';
import { isTaskHeadline } from '../org/parser';
import { formatTaskBlock } from '../org/serialize';
import type { IdStyle } from '../org/serialize';
import { inactiveStamp, timestamp } from '../org/timestamp';
import { repeaterFromText } from '../recurrence/recurrence';
import type { ParsedV1Line } from './v1Tokenizer';
import { parseV1Line } from './v1Tokenizer';

/** One converted task line, with enough context for the dry-run report. */
export interface ConvertedTask {
	/** 0-based line in the source file. */
	line: number;
	before: string;
	after: string[];
	title: string;
	/** Set when the 🔁 text needed the `:REPEAT:` rrule fallback. */
	fallbackRule?: string;
}

export interface FileConversion {
	path: string;
	content: string;
	tasks: ConvertedTask[];
	/** Checkbox lines left alone because they're checklist items of a task. */
	checklistItemsKept: number;
}

const KEYWORD_FOR_STATUS: Record<ParsedV1Line['status'], OrgKeyword> = {
	todo: 'TODO',
	done: 'DONE',
	cancelled: 'CANCELLED',
};

/**
 * Converts one v1 task line into a v2 org block.
 *
 * Mapping, token for token:
 *   `- [ ]` / `- [x]` / `- [-]`  ->  TODO / DONE / CANCELLED
 *   `!!!` / `!!`                 ->  `[#A]` / `[#B]`
 *   `⏳ 2026-07-21 09:30`        ->  `SCHEDULED: <2026-07-21 Tue 09:30>`
 *   `📅 2026-07-28`              ->  `DEADLINE: <2026-07-28 Tue>`
 *   `✅ 2026-07-15`              ->  `CLOSED: [2026-07-15 Wed 00:00]`
 *   `🔁 every week`              ->  a `++1w` repeater on SCHEDULED
 *   `🔁 every 3rd friday`        ->  `:REPEAT: every 3rd friday` (no repeater fits)
 *   `🌙`                         ->  the `:tonight:` tag
 *   `#tag`                       ->  the org tag list, `:tag:`
 *   `^t-a1b2c3`                  ->  kept as-is, or moved to `:ID:` per idStyle
 *
 * v1's ✅ stamp carried no time, so CLOSED gets 00:00 — the index's own
 * `completedAt` keeps the real timestamp, and History reads from that.
 */
export function convertLine(parsed: ParsedV1Line, idStyle: IdStyle): { lines: string[]; fallbackRule?: string } {
	const tags = [...parsed.tags];
	if (parsed.evening && !tags.includes(TONIGHT_TAG)) tags.push(TONIGHT_TAG);

	const org: OrgTask = {
		indent: parsed.indent,
		bullet: parsed.bullet,
		keyword: KEYWORD_FOR_STATUS[parsed.status],
		priority: priorityFromRank(parsed.priority),
		title: parsed.title,
		tags,
		blockId: parsed.blockId,
		properties: {},
		logbook: [],
		start: 0,
		end: 0,
	};

	let fallbackRule: string | undefined;
	const repeater = parsed.recurrenceText === undefined ? null : repeaterFromText(parsed.recurrenceText);
	if (parsed.recurrenceText !== undefined && repeater === null) {
		// Patterns org repeaters can't express ("every 3rd friday", "every
		// weekday") keep their rrule phrase in a property; the completion path
		// falls back to rrule for exactly these.
		fallbackRule = parsed.recurrenceText;
		org.properties[REPEAT_PROPERTY] = parsed.recurrenceText;
	}

	if (parsed.scheduled !== undefined) {
		org.scheduled = timestamp(parsed.scheduled, parsed.scheduledTime, repeater ?? undefined);
	}
	if (parsed.due !== undefined) {
		// A repeat with only a deadline hangs its repeater off DEADLINE, as org does.
		org.deadline = timestamp(parsed.due, undefined, parsed.scheduled === undefined ? (repeater ?? undefined) : undefined);
	}
	if (repeater && org.scheduled === undefined && org.deadline === undefined) {
		// Nothing to hang the repeater on: v1 allowed 🔁 with no date at all.
		org.properties[REPEAT_PROPERTY] = parsed.recurrenceText ?? '';
		fallbackRule = parsed.recurrenceText;
	}
	if (parsed.completedDate !== undefined) {
		org.closed = inactiveStamp(parsed.completedDate, '00:00');
	}

	return { lines: formatTaskBlock(org, idStyle), fallbackRule };
}

const LIST_ITEM_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+/;
const HEADING_RE = /^#{1,6}\s/;

/**
 * Converts a whole file. Only top-level task lines become org blocks —
 * a checkbox nested under another checkbox is a checklist item in both
 * versions and is left byte-for-byte alone, which is also what keeps its
 * `^id` (and therefore its identity) stable across the migration.
 *
 * Lines that are already v2 headlines are skipped, so re-running the migration
 * over a partly-converted vault is a no-op on the converted parts.
 */
export function convertContent(content: string, idStyle: IdStyle): {
	content: string;
	tasks: ConvertedTask[];
	checklistItemsKept: number;
} {
	const sep = content.includes('\r\n') ? '\r\n' : '\n';
	const lines = content.split(sep);
	const out: string[] = [];
	const tasks: ConvertedTask[] = [];
	let checklistItemsKept = 0;
	/** Indents of task lines whose nested items are still in scope. */
	let openTaskIndents: number[] = [];

	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i] ?? '';

		if (HEADING_RE.test(raw)) openTaskIndents = [];

		const listMatch = LIST_ITEM_RE.exec(raw);
		if (!listMatch) {
			// Blank lines and indented continuation text stay inside the list;
			// anything else at column 0 closes it.
			if (raw.trim() !== '' && !/^\s/.test(raw)) openTaskIndents = [];
			out.push(raw);
			continue;
		}

		const indent = (listMatch[1] ?? '').length;
		while (openTaskIndents.length > 0 && (openTaskIndents[openTaskIndents.length - 1] ?? 0) >= indent) {
			openTaskIndents.pop();
		}

		if (isTaskHeadline(raw)) {
			// Already converted: treat it as an open task so its checklist
			// children are still recognised as children.
			openTaskIndents.push(indent);
			out.push(raw);
			continue;
		}

		const parsed = parseV1Line(raw);
		if (!parsed) {
			out.push(raw);
			continue;
		}
		if (openTaskIndents.length > 0) {
			checklistItemsKept++;
			out.push(raw);
			continue;
		}

		const { lines: block, fallbackRule } = convertLine(parsed, idStyle);
		tasks.push({ line: i, before: raw, after: block, title: parsed.title, fallbackRule });
		openTaskIndents.push(indent);
		out.push(...block);
	}

	return { content: out.join(sep), tasks, checklistItemsKept };
}
