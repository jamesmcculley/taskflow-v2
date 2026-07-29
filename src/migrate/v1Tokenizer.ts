import type { TaskStatus } from '../types';

/**
 * v1's task-line tokenizer, kept verbatim so the migrator reads old files
 * exactly the way the plugin that wrote them did. Nothing else in v2 imports
 * this — it exists only to be the input side of the conversion.
 */
export interface ParsedV1Line {
	status: TaskStatus;
	/** Line text stripped of all metadata tokens. */
	title: string;
	scheduled?: string;
	due?: string;
	/** Date from a ✅ stamp on the line, if any. */
	completedDate?: string;
	recurrenceText?: string;
	tags: string[];
	blockId?: string;
	/** 🌙 evening flag. */
	evening: boolean;
	/** 1 = high (!!!), 2 = medium (!!). */
	priority?: 1 | 2;
	/** HH:mm following the scheduled date. */
	scheduledTime?: string;
	/** Leading whitespace, so nesting is preserved through the rewrite. */
	indent: string;
	/** The bullet as written (`- `, `* `, `1. `). */
	bullet: string;
}

const CHECKBOX_RE = /^(\s*)((?:[-*+]|\d+[.)])\s+)\[(.)\]\s?(.*)$/;
const DATE = '(\\d{4}-\\d{2}-\\d{2})';
const SCHEDULED_RE = new RegExp(`⏳\\s*${DATE}(?:\\s+(\\d{1,2}:\\d{2}))?`, 'u');
const DUE_RE = new RegExp(`📅\\s*${DATE}`, 'u');
const COMPLETED_RE = new RegExp(`✅\\s*${DATE}`, 'u');
const RECUR_RE = /🔁\s*([^⏳📅✅🔁🌙#^!]*)/u;
const EVENING_RE = /\s*🌙/u;
const PRIORITY_RE = /(^|\s)(!{2,3})(?=\s|$)/;
const BLOCK_ID_RE = /\s+\^([A-Za-z0-9-]+)\s*$/;
const TAG_RE = /(^|\s)#([A-Za-z0-9_/-]*[A-Za-z_/-][A-Za-z0-9_/-]*)/gu;

function statusFromCheckbox(char: string): TaskStatus {
	if (char === 'x' || char === 'X') return 'done';
	if (char === '-') return 'cancelled';
	return 'todo';
}

export function isV1TaskLine(line: string): boolean {
	return CHECKBOX_RE.test(line);
}

export function parseV1Line(line: string): ParsedV1Line | null {
	const m = CHECKBOX_RE.exec(line);
	if (!m) return null;
	const status = statusFromCheckbox(m[3] ?? ' ');
	let body = m[4] ?? '';

	let blockId: string | undefined;
	const bm = BLOCK_ID_RE.exec(body);
	if (bm) {
		blockId = bm[1];
		body = body.slice(0, bm.index);
	}

	const take = (re: RegExp): string | undefined => {
		const mm = re.exec(body);
		if (!mm) return undefined;
		body = body.slice(0, mm.index) + ' ' + body.slice(mm.index + mm[0].length);
		return mm[1]?.trim();
	};

	let scheduled: string | undefined;
	let scheduledTime: string | undefined;
	const sm = SCHEDULED_RE.exec(body);
	if (sm) {
		scheduled = sm[1];
		scheduledTime = sm[2] !== undefined ? normalizeTime(sm[2]) : undefined;
		body = body.slice(0, sm.index) + ' ' + body.slice(sm.index + sm[0].length);
	}
	const due = take(DUE_RE);
	const completedDate = take(COMPLETED_RE);
	const recurrenceText = take(RECUR_RE) || undefined;
	const evening = EVENING_RE.test(body);
	if (evening) body = body.replace(EVENING_RE, ' ');

	let priority: 1 | 2 | undefined;
	const pm = PRIORITY_RE.exec(body);
	if (pm) {
		priority = pm[2] === '!!!' ? 1 : 2;
		body = body.slice(0, pm.index) + (pm[1] ?? '') + body.slice(pm.index + pm[0].length);
	}

	const tags: string[] = [];
	body = body.replace(TAG_RE, (_all, pre: string, tag: string) => {
		tags.push(tag);
		return pre;
	});

	return {
		status,
		title: body.replace(/\s+/g, ' ').trim(),
		scheduled,
		due,
		completedDate,
		recurrenceText,
		tags,
		blockId,
		evening,
		priority,
		scheduledTime,
		indent: m[1] ?? '',
		bullet: m[2] ?? '- ',
	};
}

function normalizeTime(time: string): string {
	const [h, m] = time.split(':');
	return `${(h ?? '0').padStart(2, '0')}:${m ?? '00'}`;
}
