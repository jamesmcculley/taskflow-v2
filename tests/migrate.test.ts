import { describe, expect, it } from 'vitest';
import { convertContent, convertLine } from '../src/migrate/convert';
import { parseV1Line } from '../src/migrate/v1Tokenizer';
import { parseTaskAt, parseTasks } from '../src/org/parser';

/** Converts one v1 line and returns the rendered org block. */
function convert(line: string, idStyle: 'blockref' | 'properties' = 'blockref'): string[] {
	const parsed = parseV1Line(line);
	if (!parsed) throw new Error(`not a v1 task line: ${line}`);
	return convertLine(parsed, idStyle).lines;
}

describe('convertLine — token mapping', () => {
	it('maps the three checkbox states onto keywords', () => {
		expect(convert('- [ ] Thing ^t-x')[0]).toBe('- TODO Thing ^t-x');
		expect(convert('- [x] Thing ^t-x')[0]).toBe('- DONE Thing ^t-x');
		expect(convert('- [-] Thing ^t-x')[0]).toBe('- CANCELLED Thing ^t-x');
	});

	it('maps bang priorities onto org cookies', () => {
		expect(convert('- [ ] Thing !!! ^t-x')[0]).toBe('- TODO [#A] Thing ^t-x');
		expect(convert('- [ ] Thing !! ^t-x')[0]).toBe('- TODO [#B] Thing ^t-x');
	});

	it('maps ⏳ to SCHEDULED and 📅 to DEADLINE, in org key order', () => {
		expect(convert('- [ ] Thing ⏳ 2026-07-21 📅 2026-07-28 ^t-x')).toEqual([
			'- TODO Thing ^t-x',
			'  DEADLINE: <2026-07-28 Tue> SCHEDULED: <2026-07-21 Tue>',
		]);
	});

	it('carries the time-of-day onto the SCHEDULED stamp', () => {
		expect(convert('- [ ] Standup ⏳ 2026-07-21 09:30 ^t-x')[1]).toBe(
			'  SCHEDULED: <2026-07-21 Tue 09:30>',
		);
	});

	it('maps ✅ to a CLOSED stamp', () => {
		// v1's stamp carried no time, so the converted stamp reads 00:00 — the
		// index keeps the real completion timestamp.
		expect(convert('- [x] Thing ✅ 2026-07-15 ^t-x')[1]).toBe('  CLOSED: [2026-07-15 Wed 00:00]');
	});

	it('maps 🔁 onto a repeater on the SCHEDULED stamp', () => {
		expect(convert('- [ ] Email 🔁 every week ⏳ 2026-07-21 ^t-x')[1]).toBe(
			'  SCHEDULED: <2026-07-21 Tue ++1w>',
		);
	});

	it('maps "after done" onto a .+ repeater', () => {
		expect(convert('- [ ] Clean 🔁 every 2 weeks after done ⏳ 2026-07-21 ^t-x')[1]).toBe(
			'  SCHEDULED: <2026-07-21 Tue .+2w>',
		);
	});

	it('hangs the repeater off DEADLINE when that is the only stamp', () => {
		expect(convert('- [ ] Rent 🔁 every month 📅 2026-07-21 ^t-x')[1]).toBe(
			'  DEADLINE: <2026-07-21 Tue ++1m>',
		);
	});

	it('keeps unrepresentable repeats as a :REPEAT: property', () => {
		const { lines, fallbackRule } = convertLine(
			parseV1Line('- [ ] Rent 🔁 every 3rd friday ⏳ 2026-07-17 ^t-x')!,
			'blockref',
		);
		expect(fallbackRule).toBe('every 3rd friday');
		expect(lines).toEqual([
			'- TODO Rent ^t-x',
			'  SCHEDULED: <2026-07-17 Fri>',
			'  :PROPERTIES:',
			'  :REPEAT: every 3rd friday',
			'  :END:',
		]);
	});

	it('falls back to :REPEAT: when a repeat has no date to hang off', () => {
		const { fallbackRule } = convertLine(parseV1Line('- [ ] Thing 🔁 every week ^t-x')!, 'blockref');
		expect(fallbackRule).toBe('every week');
	});

	it('maps 🌙 onto the tonight tag and #tags onto an org tag list', () => {
		expect(convert('- [ ] Read 🌙 #home #books ^t-x')[0]).toBe(
			'- TODO Read :home:books:tonight: ^t-x',
		);
	});

	it('keeps #someday as a tag, so Someday behaves exactly as it did', () => {
		expect(convert('- [ ] Learn Greek #someday ^t-x')[0]).toBe('- TODO Learn Greek :someday: ^t-x');
	});

	it('preserves indentation and the bullet style as written', () => {
		expect(convert('\t* [ ] Thing ^t-x')[0]).toBe('\t* TODO Thing ^t-x');
	});

	it('moves the ID into a drawer under the properties style', () => {
		expect(convert('- [ ] Thing ^t-x', 'properties')).toEqual([
			'- TODO Thing',
			'  :PROPERTIES:',
			'  :ID: t-x',
			'  :END:',
		]);
	});

	it('round-trips every field back out through the v2 parser', () => {
		const block = convert('- [x] Ship it !!! ⏳ 2026-07-21 09:30 📅 2026-07-28 ✅ 2026-07-15 #dev 🌙 ^t-x');
		const org = parseTaskAt(block, 0);
		expect(org).toMatchObject({ keyword: 'DONE', priority: 'A', title: 'Ship it', blockId: 't-x' });
		expect(org?.scheduled).toMatchObject({ date: '2026-07-21', time: '09:30' });
		expect(org?.deadline?.date).toBe('2026-07-28');
		expect(org?.closed?.date).toBe('2026-07-15');
		expect(org?.tags).toEqual(['dev', 'tonight']);
	});
});

describe('convertContent — whole files', () => {
	it('converts top-level tasks and leaves checklist children as checkboxes', () => {
		const source = [
			'# Project',
			'',
			'- [ ] Parent ⏳ 2026-07-21 ^t-parent',
			'\t- [ ] Child one ^t-c1',
			'\t- [x] Child two ^t-c2',
			'- [ ] Sibling ^t-sib',
			'',
		].join('\n');
		const result = convertContent(source, 'blockref');
		expect(result.tasks).toHaveLength(2);
		expect(result.checklistItemsKept).toBe(2);
		expect(result.content.split('\n')).toEqual([
			'# Project',
			'',
			'- TODO Parent ^t-parent',
			'  SCHEDULED: <2026-07-21 Tue>',
			'\t- [ ] Child one ^t-c1',
			'\t- [x] Child two ^t-c2',
			'- TODO Sibling ^t-sib',
			'',
		]);
	});

	it('treats a checkbox after a heading as top-level again', () => {
		const source = ['- [ ] Parent ^t-p', '\t- [ ] Child ^t-c', '## Next', '- [ ] After ^t-a'].join('\n');
		const result = convertContent(source, 'blockref');
		expect(result.tasks.map((t) => t.title)).toEqual(['Parent', 'After']);
	});

	it('leaves non-task content byte-for-byte alone', () => {
		const source = [
			'---',
			'type: project',
			'---',
			'',
			'Some prose with a - dash and [brackets].',
			'',
			'| a | b |',
			'| - | - |',
			'',
		].join('\n');
		expect(convertContent(source, 'blockref').content).toBe(source);
	});

	it('preserves CRLF line endings', () => {
		const source = '- [ ] Thing ⏳ 2026-07-21 ^t-x\r\n- [ ] Other ^t-y\r\n';
		const out = convertContent(source, 'blockref').content;
		expect(out).toContain('\r\n');
		expect(out).not.toMatch(/[^\r]\n/);
	});

	it('is idempotent — re-running over converted content changes nothing', () => {
		const source = ['- [ ] Parent ⏳ 2026-07-21 ^t-p', '\t- [ ] Child ^t-c', ''].join('\n');
		const once = convertContent(source, 'blockref');
		const twice = convertContent(once.content, 'blockref');
		expect(twice.content).toBe(once.content);
		expect(twice.tasks).toHaveLength(0);
	});

	it('converts the untouched half of a partly-migrated file', () => {
		const source = [
			'- TODO Already converted ^t-1',
			'  SCHEDULED: <2026-07-21 Tue>',
			'- [ ] Still v1 ^t-2',
			'',
		].join('\n');
		const result = convertContent(source, 'blockref');
		expect(result.tasks.map((t) => t.title)).toEqual(['Still v1']);
		expect(parseTasks(result.content.split('\n')).map((t) => t.blockId)).toEqual(['t-1', 't-2']);
	});

	it('keeps every task ID, which is what lets data.json carry over', () => {
		const source = ['- [ ] A ^t-aaa', '- [x] B ✅ 2026-07-15 ^t-bbb', '- [-] C ^t-ccc'].join('\n');
		const ids = parseTasks(convertContent(source, 'blockref').content.split('\n')).map((t) => t.blockId);
		expect(ids).toEqual(['t-aaa', 't-bbb', 't-ccc']);
	});

	it('reports every task it would change, for the dry run', () => {
		const source = ['- [ ] One ^t-1', '- [x] Two ^t-2'].join('\n');
		const { tasks } = convertContent(source, 'blockref');
		expect(tasks.map((t) => ({ line: t.line, title: t.title, before: t.before }))).toEqual([
			{ line: 0, title: 'One', before: '- [ ] One ^t-1' },
			{ line: 1, title: 'Two', before: '- [x] Two ^t-2' },
		]);
	});

	it('does not touch a checkbox that was never a task line', () => {
		// A checkbox with no ID is still a v1 task (the indexer would assign one),
		// but a table row or a stray bracket is not.
		const source = ['Text [x] not a checkbox', '| [ ] | cell |'].join('\n');
		expect(convertContent(source, 'blockref').tasks).toHaveLength(0);
	});
});
