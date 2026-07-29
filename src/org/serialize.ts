import type { OrgTask } from './parser';
import { parseTaskAt } from './parser';
import { formatTimestamp } from './timestamp';

export type IdStyle = 'blockref' | 'properties';

/**
 * The indent continuation lines get: enough to sit under the headline's text,
 * so markdown renders the planning line and drawers as part of the same list
 * item instead of breaking the list.
 */
export function contentIndent(task: Pick<OrgTask, 'indent' | 'bullet'>): string {
	return task.indent + ' '.repeat(task.bullet.length || 2);
}

/** `- TODO [#A] Ship the thing :work: ^t-a1b2c3` */
export function formatHeadline(task: OrgTask, idStyle: IdStyle): string {
	let line = `${task.indent}${task.bullet}${task.keyword}`;
	if (task.priority) line += ` [#${task.priority}]`;
	if (task.title !== '') line += ` ${task.title}`;
	if (task.tags.length > 0) line += ` :${task.tags.join(':')}:`;
	if (idStyle === 'blockref' && task.blockId !== undefined) line += ` ^${task.blockId}`;
	return line;
}

/** `CLOSED: [...] DEADLINE: <...> SCHEDULED: <...>` — org's own key order. */
export function formatPlanningLine(task: OrgTask): string | null {
	const parts: string[] = [];
	if (task.closed) parts.push(`CLOSED: ${formatTimestamp(task.closed)}`);
	if (task.deadline) parts.push(`DEADLINE: ${formatTimestamp(task.deadline)}`);
	if (task.scheduled) parts.push(`SCHEDULED: ${formatTimestamp(task.scheduled)}`);
	if (parts.length === 0) return null;
	return contentIndent(task) + parts.join(' ');
}

/**
 * Renders the whole rewritable region: headline, planning line, then the
 * PROPERTIES and LOGBOOK drawers. Drawers are emitted only when they have
 * content, so an ordinary task stays a two-line block.
 */
export function formatTaskBlock(task: OrgTask, idStyle: IdStyle): string[] {
	const pad = contentIndent(task);
	const out = [formatHeadline(task, idStyle)];

	const planning = formatPlanningLine(task);
	if (planning !== null) out.push(planning);

	const properties = { ...task.properties };
	if (idStyle === 'properties' && task.blockId !== undefined) properties.ID = task.blockId;
	else delete properties.ID;
	const keys = Object.keys(properties).sort((a, b) => (a === 'ID' ? -1 : b === 'ID' ? 1 : a.localeCompare(b)));
	if (keys.length > 0) {
		out.push(`${pad}:PROPERTIES:`);
		for (const key of keys) out.push(`${pad}:${key}: ${properties[key] ?? ''}`);
		out.push(`${pad}:END:`);
	}

	if (task.logbook.length > 0) {
		out.push(`${pad}:LOGBOOK:`);
		out.push(...task.logbook);
		out.push(`${pad}:END:`);
	}
	return out;
}

/**
 * Parse → mutate → re-emit, in place. Every mutation in the plugin goes
 * through this: it keeps the block's shape canonical (planning line before
 * drawers, drawers dropped when empty) without any of v1's per-token regex
 * surgery, and it never touches a line outside the block.
 *
 * Returns the new line count delta so callers editing several blocks in one
 * pass can keep their indexes straight; -1 signals "no task there".
 */
export function editTaskBlock(
	lines: string[],
	start: number,
	idStyle: IdStyle,
	mutate: (task: OrgTask) => void,
): number {
	const task = parseTaskAt(lines, start);
	if (!task) return -1;
	mutate(task);
	const replacement = formatTaskBlock(task, idStyle);
	const removed = task.end - task.start + 1;
	lines.splice(task.start, removed, ...replacement);
	return replacement.length - removed;
}

/** A one-off task block for a brand-new task (capture, project move). */
export function newTaskBlock(fields: Partial<OrgTask> & Pick<OrgTask, 'keyword' | 'title'>): OrgTask {
	return {
		indent: '',
		bullet: '- ',
		tags: [],
		properties: {},
		logbook: [],
		start: 0,
		end: 0,
		...fields,
	};
}

/**
 * Appends a `State "DONE" from "TODO" [stamp]` line, org's own logbook format.
 * Recurring tasks are the reason this exists: their headline is rewritten back
 * to TODO on every completion, so the logbook is the only in-file record that
 * the occurrence happened.
 */
export function appendLogbookEntry(task: OrgTask, from: string, to: string, stamp: string): void {
	task.logbook.push(`${contentIndent(task)}- State "${to}" from "${from}" ${stamp}`);
}
