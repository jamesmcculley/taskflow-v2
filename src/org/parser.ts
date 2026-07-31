import type { OrgKeyword, OrgPriority } from './keywords';
import { isOrgKeyword, isOrgPriority } from './keywords';
import type { OrgTimestamp } from './timestamp';
import { normalizeTime, parseTimestamp } from './timestamp';

/**
 * A task as it sits in the file: the headline plus the contiguous planning
 * line and drawers directly beneath it. That contiguous run is the only region
 * TaskFlow ever rewrites — anything after it (checklist boxes, notes, nested
 * content) is left byte-for-byte alone, so a task block can be edited without
 * touching the prose around it.
 */
export interface OrgTask {
	/** Leading whitespace of the headline. */
	indent: string;
	/** `- `, `* `, `1. ` … or '' for the bare (non-list) headline form. */
	bullet: string;
	keyword: OrgKeyword;
	priority?: OrgPriority;
	/** Headline text with keyword, cookie, tags, and block ref removed. */
	title: string;
	tags: string[];
	/** The `^t-xxxxxx` block ref, when the ID rides on the headline. */
	blockId?: string;
	scheduled?: OrgTimestamp;
	deadline?: OrgTimestamp;
	closed?: OrgTimestamp;
	/** `:PROPERTIES:` drawer contents, key (without colons) -> value. */
	properties: Record<string, string>;
	/** `:LOGBOOK:` drawer body lines, kept verbatim. */
	logbook: string[];
	/** First line of the block (the headline), 0-based. */
	start: number;
	/** Last line of the rewritable region, inclusive. Equals `start` when bare. */
	end: number;
}

/**
 * Headline shapes accepted on read:
 *   `- TODO Buy milk`      list item (what TaskFlow writes)
 *   `TODO Buy milk`        bare line, as plain org would have it
 *   `- [ ] TODO Buy milk`  a half-migrated v1 line — the box is ignored
 * The bullet is optional so hand-written org pasted into a note still indexes.
 */
const HEADLINE_RE = /^(\s*)((?:[-*+]|\d+[.)])\s+)?(?:\[[ xX-]\]\s+)?([A-Z]{2,12})\b\s*(.*)$/;
const PRIORITY_RE = /^\[#([A-Za-z])\]\s*/;
const BLOCK_ID_RE = /\s+\^([A-Za-z0-9-]+)\s*$/;
/**
 * Org tag lists sit at the end of the headline: `:work:urgent:`. The charset
 * adds `/` to org's own so Obsidian's nested tags (`work/client`) survive a
 * round trip — v1 matched nested tags by prefix and the filters still do.
 */
const TAGS_RE = /\s+(:(?:[A-Za-z0-9_@%/-]+:)+)\s*$/;

const PLANNING_KEYS = ['CLOSED', 'DEADLINE', 'SCHEDULED'] as const;
const PLANNING_LINE_RE = /^\s*(?:CLOSED|DEADLINE|SCHEDULED):\s*[<[]/;
const PLANNING_PART_RE = /(CLOSED|DEADLINE|SCHEDULED):\s*(<[^>]*>|\[[^\]]*\])/g;
const DRAWER_OPEN_RE = /^\s*:([A-Za-z][A-Za-z0-9_-]*):\s*$/;
const DRAWER_END_RE = /^\s*:END:\s*$/i;
const PROPERTY_RE = /^\s*:([A-Za-z][A-Za-z0-9_-]*):\s*(.*?)\s*$/;

/** True if the line opens a task. Cheap enough to run over every line. */
export function isTaskHeadline(line: string): boolean {
	const m = HEADLINE_RE.exec(line);
	return m !== null && isOrgKeyword(m[3] ?? '');
}

/** Parses just the headline. Returns null when the line isn't one. */
export function parseHeadline(
	line: string,
): Pick<OrgTask, 'indent' | 'bullet' | 'keyword' | 'priority' | 'title' | 'tags' | 'blockId'> | null {
	const m = HEADLINE_RE.exec(line);
	if (!m) return null;
	const keyword = m[3] ?? '';
	if (!isOrgKeyword(keyword)) return null;

	let rest = m[4] ?? '';

	// Consume *every* trailing `^id`, not just the last. A headline should only
	// ever carry one; more than one is damage from the duplicate-ID bug, and
	// stripping only the last left the earlier one stuck in the title (and
	// re-emitted forever). Taking the last as the real ID keeps the parse
	// stable, so a repaired line indexes as the same task it did while broken.
	let blockId: string | undefined;
	for (;;) {
		const bm = BLOCK_ID_RE.exec(rest);
		if (!bm) break;
		blockId ??= bm[1];
		rest = rest.slice(0, bm.index);
	}

	const tags: string[] = [];
	const tm = TAGS_RE.exec(rest);
	if (tm) {
		for (const tag of (tm[1] ?? '').split(':')) {
			if (tag !== '') tags.push(tag);
		}
		rest = rest.slice(0, tm.index);
	}

	let priority: OrgPriority | undefined;
	const pm = PRIORITY_RE.exec(rest);
	if (pm) {
		const letter = (pm[1] ?? '').toUpperCase();
		if (isOrgPriority(letter)) {
			priority = letter;
			rest = rest.slice(pm[0].length);
		}
	}

	return {
		indent: m[1] ?? '',
		bullet: m[2] ?? '',
		keyword,
		priority,
		title: rest.replace(/\s+/g, ' ').trim(),
		tags,
		blockId,
	};
}

/** Pulls CLOSED/DEADLINE/SCHEDULED off a planning line, in any order. */
export function parsePlanningLine(line: string): Pick<OrgTask, 'scheduled' | 'deadline' | 'closed'> {
	const out: Pick<OrgTask, 'scheduled' | 'deadline' | 'closed'> = {};
	for (const m of line.matchAll(PLANNING_PART_RE)) {
		const ts = parseTimestamp(m[2] ?? '');
		if (!ts) continue;
		if (m[1] === 'SCHEDULED') out.scheduled = ts;
		else if (m[1] === 'DEADLINE') out.deadline = ts;
		else out.closed = ts;
	}
	return out;
}

/**
 * Parses the task starting at `start`. Consumes the contiguous planning line
 * and drawers below the headline; stops at the first line that is neither
 * (blank lines end the block, so a drawer separated by whitespace is treated
 * as prose and left alone rather than silently absorbed and rewritten).
 */
export function parseTaskAt(lines: string[], start: number): OrgTask | null {
	const headlineText = lines[start];
	if (headlineText === undefined) return null;
	const headline = parseHeadline(headlineText);
	if (!headline) return null;

	const task: OrgTask = {
		...headline,
		properties: {},
		logbook: [],
		start,
		end: start,
	};

	let i = start + 1;
	while (i < lines.length) {
		const line = lines[i];
		if (line === undefined) break;

		if (PLANNING_LINE_RE.test(line)) {
			Object.assign(task, parsePlanningLine(line));
			task.end = i;
			i++;
			continue;
		}

		const drawer = DRAWER_OPEN_RE.exec(line);
		if (drawer) {
			const name = (drawer[1] ?? '').toUpperCase();
			if (name !== 'PROPERTIES' && name !== 'LOGBOOK') break;
			let j = i + 1;
			const body: string[] = [];
			while (j < lines.length && !DRAWER_END_RE.test(lines[j] ?? '')) {
				body.push(lines[j] ?? '');
				j++;
			}
			// An unterminated drawer is malformed; leave it to the user rather
			// than swallowing the rest of the file into this task's block.
			if (j >= lines.length) break;
			if (name === 'PROPERTIES') {
				for (const raw of body) {
					const pm = PROPERTY_RE.exec(raw);
					if (pm && pm[1] !== undefined) task.properties[pm[1].toUpperCase()] = pm[2] ?? '';
				}
			} else {
				task.logbook.push(...body);
			}
			task.end = j;
			i = j + 1;
			continue;
		}
		break;
	}

	// A drawer :ID: is the org-native home for the identifier; a ^block-ref on
	// the headline is the Obsidian-native one. Either carries it, drawer wins.
	const drawerId = task.properties.ID;
	if (drawerId !== undefined && drawerId !== '') task.blockId = drawerId;

	if (task.scheduled?.time !== undefined) task.scheduled.time = normalizeTime(task.scheduled.time);
	return task;
}

/** Every task in a file, in line order. Used by the migrator and tests. */
export function parseTasks(lines: string[]): OrgTask[] {
	const tasks: OrgTask[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined || !isTaskHeadline(line)) continue;
		const task = parseTaskAt(lines, i);
		if (!task) continue;
		tasks.push(task);
		i = task.end;
	}
	return tasks;
}

export { PLANNING_KEYS };
