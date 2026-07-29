import { describe, expect, it } from 'vitest';
import { buildHistoryCsv } from '../src/store/csv';

describe('buildHistoryCsv', () => {
	it('renders header + rows with project names resolved', () => {
		const csv = buildHistoryCsv(
			[
				{
					taskId: 't-a',
					title: 'Ship it',
					project: 'P/Site.md',
					status: 'done',
					completedAt: new Date(2026, 6, 19, 12).toISOString(),
				},
			],
			{ 'P/Site.md': { path: 'P/Site.md', name: 'Site', status: 'active' } },
		);
		const lines = csv.trim().split('\n');
		expect(lines[0]).toBe('completedAt,day,status,title,project');
		expect(lines[1]).toContain('2026-07-19,done,"Ship it","Site"');
	});

	it('escapes quotes and neutralizes formula injection', () => {
		const csv = buildHistoryCsv(
			[
				{
					taskId: 't-a',
					title: '=HYPERLINK("http://evil","x")',
					status: 'done',
					completedAt: new Date(2026, 6, 19, 12).toISOString(),
				},
				{
					taskId: 't-b',
					title: 'Say "hi" +1',
					status: 'done',
					completedAt: new Date(2026, 6, 19, 12).toISOString(),
				},
			],
			{},
		);
		expect(csv).toContain('"\'=HYPERLINK(""http://evil"",""x"")"');
		expect(csv).toContain('"Say ""hi"" +1"');
	});
});
