import { describe, expect, it } from 'vitest';
import { parseHeadline, parsePlanningLine, parseTaskAt, parseTasks } from '../src/org/parser';
import { editTaskBlock, formatTaskBlock, newTaskBlock } from '../src/org/serialize';
import { formatTimestamp, parseTimestamp, timestamp } from '../src/org/timestamp';

describe('parseTimestamp', () => {
	it('parses active timestamps with and without a time', () => {
		expect(parseTimestamp('<2026-07-21 Tue>')).toMatchObject({ date: '2026-07-21', active: true });
		expect(parseTimestamp('<2026-07-21 Tue 09:30>')).toMatchObject({
			date: '2026-07-21',
			time: '09:30',
		});
	});

	it('parses a time range', () => {
		expect(parseTimestamp('<2026-07-21 Tue 09:30-10:15>')).toMatchObject({
			time: '09:30',
			endTime: '10:15',
		});
	});

	it('parses inactive timestamps', () => {
		expect(parseTimestamp('[2026-07-15 Wed 14:32]')).toMatchObject({
			date: '2026-07-15',
			time: '14:32',
			active: false,
		});
	});

	it('parses every repeater kind', () => {
		expect(parseTimestamp('<2026-07-21 Tue +1w>')?.repeater).toEqual({
			kind: '+',
			value: 1,
			unit: 'w',
		});
		expect(parseTimestamp('<2026-07-21 Tue ++2d>')?.repeater).toEqual({
			kind: '++',
			value: 2,
			unit: 'd',
		});
		expect(parseTimestamp('<2026-07-21 Tue .+3m>')?.repeater).toEqual({
			kind: '.+',
			value: 3,
			unit: 'm',
		});
	});

	it('tolerates a missing day name and normalises a short time', () => {
		expect(parseTimestamp('<2026-07-21 9:05>')).toMatchObject({ date: '2026-07-21', time: '09:05' });
	});

	it('round-trips through formatTimestamp with the right day name', () => {
		// 2026-07-21 is a Tuesday.
		expect(formatTimestamp(timestamp('2026-07-21'))).toBe('<2026-07-21 Tue>');
		expect(formatTimestamp(timestamp('2026-07-21', '09:30'))).toBe('<2026-07-21 Tue 09:30>');
	});
});

describe('parseHeadline', () => {
	it('parses the full shape', () => {
		expect(parseHeadline('- TODO [#A] Ship the thing :work:urgent: ^t-a1b2c3')).toMatchObject({
			bullet: '- ',
			keyword: 'TODO',
			priority: 'A',
			title: 'Ship the thing',
			tags: ['work', 'urgent'],
			blockId: 't-a1b2c3',
		});
	});

	it('accepts the bare (non-list) form org itself would write', () => {
		expect(parseHeadline('TODO Buy milk')).toMatchObject({ bullet: '', title: 'Buy milk' });
	});

	it('accepts a half-migrated line that still has its checkbox', () => {
		expect(parseHeadline('- [ ] TODO Buy milk')).toMatchObject({
			keyword: 'TODO',
			title: 'Buy milk',
		});
	});

	it('keeps nested Obsidian tags intact', () => {
		expect(parseHeadline('- TODO Call :work/client:')?.tags).toEqual(['work/client']);
	});

	it('rejects a line whose leading word is not a keyword', () => {
		expect(parseHeadline('- CALL the vet')).toBeNull();
		expect(parseHeadline('- Buy milk')).toBeNull();
		expect(parseHeadline('## TODO list')).toBeNull();
	});

	it('does not mistake a lone bracket for a priority cookie', () => {
		expect(parseHeadline('- TODO Read [#hashtag] docs')).toMatchObject({
			priority: undefined,
			title: 'Read [#hashtag] docs',
		});
	});
});

describe('parsePlanningLine', () => {
	it('reads all three keys in any order', () => {
		const parsed = parsePlanningLine(
			'  CLOSED: [2026-07-15 Wed 14:32] DEADLINE: <2026-07-28 Tue> SCHEDULED: <2026-07-21 Tue>',
		);
		expect(parsed.closed?.date).toBe('2026-07-15');
		expect(parsed.deadline?.date).toBe('2026-07-28');
		expect(parsed.scheduled?.date).toBe('2026-07-21');
	});

	it('reads a line carrying only one key', () => {
		expect(parsePlanningLine('  SCHEDULED: <2026-07-21 Tue>').deadline).toBeUndefined();
	});
});

describe('parseTaskAt', () => {
	const lines = [
		'- TODO [#B] Set up staging :dev: ^t-stage',
		'  DEADLINE: <2026-07-28 Tue> SCHEDULED: <2026-07-21 Tue 09:30 ++1w>',
		'  :PROPERTIES:',
		'  :EFFORT: 2h',
		'  :END:',
		'  :LOGBOOK:',
		'  - State "DONE" from "TODO" [2026-07-14 Tue 11:00]',
		'  :END:',
		'  - [ ] provision box',
		'',
		'Some prose.',
	];

	it('consumes the planning line and both drawers, and stops there', () => {
		const task = parseTaskAt(lines, 0);
		expect(task).toMatchObject({
			keyword: 'TODO',
			priority: 'B',
			title: 'Set up staging',
			tags: ['dev'],
			blockId: 't-stage',
		});
		expect(task?.scheduled).toMatchObject({ date: '2026-07-21', time: '09:30' });
		expect(task?.scheduled?.repeater).toEqual({ kind: '++', value: 1, unit: 'w' });
		expect(task?.deadline?.date).toBe('2026-07-28');
		expect(task?.properties).toEqual({ EFFORT: '2h' });
		expect(task?.logbook).toHaveLength(1);
		// The block ends at the closing :END: — the checklist item below it is
		// not part of the rewritable region.
		expect(task?.end).toBe(7);
	});

	it('prefers an :ID: property over a block ref', () => {
		const task = parseTaskAt(
			['- TODO Thing ^t-old', '  :PROPERTIES:', '  :ID: t-new', '  :END:'],
			0,
		);
		expect(task?.blockId).toBe('t-new');
	});

	it('does not swallow the file when a drawer is never closed', () => {
		const task = parseTaskAt(['- TODO Thing', '  :PROPERTIES:', '  :ID: t-x', 'more prose'], 0);
		expect(task?.end).toBe(0);
	});

	it('does not absorb a drawer separated from the headline by a blank line', () => {
		const task = parseTaskAt(['- TODO Thing', '', '  :PROPERTIES:', '  :FOO: bar', '  :END:'], 0);
		expect(task?.end).toBe(0);
		expect(task?.properties).toEqual({});
	});

	it('ignores an unknown drawer rather than rewriting it', () => {
		const task = parseTaskAt(['- TODO Thing', '  :NOTES:', '  hello', '  :END:'], 0);
		expect(task?.end).toBe(0);
	});
});

describe('parseTasks', () => {
	it('finds each task once and skips over its block', () => {
		const tasks = parseTasks([
			'# Notes',
			'- TODO First ^t-1',
			'  SCHEDULED: <2026-07-21 Tue>',
			'- DONE Second ^t-2',
			'  CLOSED: [2026-07-15 Wed 09:00]',
			'',
			'- NEXT Third ^t-3',
		]);
		expect(tasks.map((t) => t.blockId)).toEqual(['t-1', 't-2', 't-3']);
		expect(tasks.map((t) => t.keyword)).toEqual(['TODO', 'DONE', 'NEXT']);
	});
});

describe('formatTaskBlock', () => {
	it('emits org key order: CLOSED, DEADLINE, SCHEDULED', () => {
		const task = newTaskBlock({ keyword: 'DONE', title: 'Thing' });
		task.scheduled = timestamp('2026-07-21');
		task.deadline = timestamp('2026-07-28');
		task.closed = { date: '2026-07-15', time: '14:32', active: false };
		expect(formatTaskBlock(task, 'blockref')[1]).toBe(
			'  CLOSED: [2026-07-15 Wed 14:32] DEADLINE: <2026-07-28 Tue> SCHEDULED: <2026-07-21 Tue>',
		);
	});

	it('stays a one-line block when there is nothing to plan', () => {
		const task = newTaskBlock({ keyword: 'TODO', title: 'Buy milk', blockId: 't-x' });
		expect(formatTaskBlock(task, 'blockref')).toEqual(['- TODO Buy milk ^t-x']);
	});

	it('writes the ID into a drawer under the properties style', () => {
		const task = newTaskBlock({ keyword: 'TODO', title: 'Buy milk', blockId: 't-x' });
		expect(formatTaskBlock(task, 'properties')).toEqual([
			'- TODO Buy milk',
			'  :PROPERTIES:',
			'  :ID: t-x',
			'  :END:',
		]);
	});

	it('indents continuation lines under the headline text', () => {
		const task = newTaskBlock({ keyword: 'TODO', title: 'Nested', indent: '\t' });
		task.scheduled = timestamp('2026-07-21');
		expect(formatTaskBlock(task, 'blockref')[1]).toBe('\t  SCHEDULED: <2026-07-21 Tue>');
	});
});

describe('editTaskBlock', () => {
	it('rewrites in place and reports the line delta', () => {
		const lines = ['intro', '- TODO Thing ^t-x', 'outro'];
		const delta = editTaskBlock(lines, 1, 'blockref', (task) => {
			task.scheduled = timestamp('2026-07-21');
		});
		expect(delta).toBe(1);
		expect(lines).toEqual([
			'intro',
			'- TODO Thing ^t-x',
			'  SCHEDULED: <2026-07-21 Tue>',
			'outro',
		]);
	});

	it('drops the planning line when the last stamp is cleared', () => {
		const lines = ['- TODO Thing ^t-x', '  SCHEDULED: <2026-07-21 Tue>', 'outro'];
		editTaskBlock(lines, 0, 'blockref', (task) => {
			task.scheduled = undefined;
		});
		expect(lines).toEqual(['- TODO Thing ^t-x', 'outro']);
	});

	it('leaves everything outside the block untouched', () => {
		const lines = ['- TODO Thing ^t-x', '  - [ ] child ^t-c', 'prose'];
		editTaskBlock(lines, 0, 'blockref', (task) => {
			task.keyword = 'NEXT';
		});
		expect(lines).toEqual(['- NEXT Thing ^t-x', '  - [ ] child ^t-c', 'prose']);
	});

	it('returns -1 when there is no task at that line', () => {
		expect(editTaskBlock(['plain text'], 0, 'blockref', () => undefined)).toBe(-1);
	});
});
