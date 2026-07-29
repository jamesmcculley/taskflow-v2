import { isTaskHeadline, parseTaskAt } from '../org/parser';
import type { OrgTask } from '../org/parser';

/**
 * Splits content preserving the file's line-ending style, so edits on CRLF
 * vaults stay byte-for-byte outside the touched lines.
 */
export function splitLines(content: string): { lines: string[]; sep: '\n' | '\r\n' } {
	const sep = content.includes('\r\n') ? '\r\n' : '\n';
	return { lines: content.split(sep), sep };
}

/**
 * Finds a task's block by ID, preferring the remembered line. v1 could match a
 * task by scanning for its `^block-ref`; here the ID may instead live in a
 * PROPERTIES drawer, so the search parses candidate headlines rather than
 * regex-matching raw text.
 */
export function findTaskBlock(lines: string[], id: string, knownLine?: number): OrgTask | null {
	if (knownLine !== undefined) {
		const at = parseTaskAt(lines, knownLine);
		if (at?.blockId === id) return at;
	}
	for (let i = 0; i < lines.length; i++) {
		if (!isTaskHeadline(lines[i] ?? '')) continue;
		const task = parseTaskAt(lines, i);
		if (task?.blockId === id) return task;
		if (task) i = task.end;
	}
	return null;
}

/** Finds the checklist checkbox carrying `^id`, ignoring task headlines. */
export function findChecklistLine(lines: string[], id: string): number {
	const re = new RegExp(`\\^${id}\\s*$`);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined || isTaskHeadline(line)) continue;
		if (re.test(line)) return i;
	}
	return -1;
}

const CHECKBOX_PREFIX_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)(.)(\])/;

/** Ticks or unticks a plain checklist checkbox (not a keyword task). */
export function setCheckboxState(line: string, done: boolean): string {
	return line.replace(CHECKBOX_PREFIX_RE, (_m, pre: string, _c: string, post: string) => {
		return pre + (done ? 'x' : ' ') + post;
	});
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;

/** Inserts a rendered task block above the file's first heading (or appends). */
export function insertTaskBlockBeforeHeadings(content: string, block: string[]): string {
	const { lines, sep } = splitLines(content);
	const idx = lines.findIndex((l) => /^#{1,6}\s/.test(l));
	if (idx === -1) return insertTaskBlock(content, block);
	let pos = idx;
	while (pos > 0 && (lines[pos - 1] ?? '').trim() === '') pos--;
	lines.splice(pos, 0, ...block);
	return lines.join(sep);
}

/** Inserts a rendered task block at the end of a heading's section, or at EOF. */
export function insertTaskBlock(content: string, block: string[], heading?: string): string {
	const { lines: split, sep } = splitLines(content);
	const lines = content.length === 0 ? [] : split;
	if (heading !== undefined) {
		let headingLevel = 0;
		let headingIdx = -1;
		for (let i = 0; i < lines.length; i++) {
			const m = HEADING_RE.exec(lines[i] ?? '');
			if (m && m[2] === heading) {
				headingLevel = (m[1] ?? '#').length;
				headingIdx = i;
				break;
			}
		}
		if (headingIdx === -1) {
			// Heading not present: create it at the end of the file.
			if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
			lines.push(`## ${heading}`, '', ...block);
			return lines.join(sep) + sep;
		}
		let end = lines.length;
		for (let i = headingIdx + 1; i < lines.length; i++) {
			const m = HEADING_RE.exec(lines[i] ?? '');
			if (m && (m[1] ?? '').length <= headingLevel) {
				end = i;
				break;
			}
		}
		// Insert after the last non-blank line of the section.
		while (end > headingIdx + 1 && (lines[end - 1] ?? '').trim() === '') end--;
		lines.splice(end, 0, ...block);
		return lines.join(sep);
	}
	while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() === '') lines.pop();
	lines.push(...block);
	return lines.join(sep) + sep;
}

/**
 * Lifts a task block out of a file: returns the block's lines (dedented to
 * column 0, since a moved task becomes a top-level item wherever it lands) and
 * the content with those lines removed.
 */
export function extractTaskBlock(
	content: string,
	id: string,
	knownLine?: number,
): { block: string[]; rest: string } | null {
	const { lines, sep } = splitLines(content);
	const task = findTaskBlock(lines, id, knownLine);
	if (!task) return null;
	const width = task.indent.length;
	const block = lines
		.slice(task.start, task.end + 1)
		.map((l) => (l.startsWith(task.indent) ? l.slice(width) : l.replace(/^\s+/, '')));
	lines.splice(task.start, task.end - task.start + 1);
	return { block, rest: lines.join(sep) };
}
