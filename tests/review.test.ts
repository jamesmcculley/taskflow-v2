import { describe, expect, it } from 'vitest';
import {
	buildReviewNote,
	groupCompletionsByArea,
	reviewNotePath,
	selectPeriodCompletions,
	selectRolledHighlights,
} from '../src/store/review';
import type { CompletionEntry, PeriodNote, ProjectInfo } from '../src/types';

const entry = (
	taskId: string,
	title: string,
	completedAt: string,
	project?: string,
): CompletionEntry => ({ taskId, title, project, status: 'done', completedAt });

const projects: Record<string, ProjectInfo> = {
	'P/Site.md': { path: 'P/Site.md', name: 'Website', status: 'active', area: 'Platform' },
	'P/Hiring.md': { path: 'P/Hiring.md', name: 'Hiring', status: 'active', area: 'Team' },
};

const log: CompletionEntry[] = [
	entry('t-1', 'Shipped the staging pipeline', '2026-07-29T14:00:00.000Z', 'P/Site.md'),
	entry('t-2', 'Reviewed the design doc', '2026-07-30T09:00:00.000Z', 'P/Site.md'),
	entry('t-3', 'Closed out two offers', '2026-07-28T17:00:00.000Z', 'P/Hiring.md'),
	entry('t-4', 'Tidied the desk', '2026-07-15T11:00:00.000Z'),
	entry('t-5', 'Out of range', '2026-06-01T11:00:00.000Z', 'P/Site.md'),
	{ ...entry('t-6', 'Abandoned', '2026-07-29T11:00:00.000Z'), status: 'cancelled' },
];

describe('selectPeriodCompletions', () => {
	it('takes only entries inside the period, newest first', () => {
		expect(selectPeriodCompletions(log, '2026-W31').map((e) => e.taskId)).toEqual([
			't-2',
			't-1',
			't-3',
		]);
	});

	it('widens with the period', () => {
		expect(selectPeriodCompletions(log, '2026-07').map((e) => e.taskId)).toEqual([
			't-2',
			't-1',
			't-3',
			't-4',
		]);
	});

	it('excludes cancelled work — a review is what got finished', () => {
		expect(selectPeriodCompletions(log, '2026-07').map((e) => e.taskId)).not.toContain('t-6');
	});

	it('returns nothing for a malformed key', () => {
		expect(selectPeriodCompletions(log, 'not-a-period')).toEqual([]);
	});
});

describe('groupCompletionsByArea', () => {
	it('groups by area then project, with unfiled last', () => {
		const grouped = groupCompletionsByArea(selectPeriodCompletions(log, '2026-07'), projects);
		expect(grouped.map((g) => g.area)).toEqual(['Platform', 'Team', undefined]);
		expect(grouped[0]?.projects.map((p) => p.name)).toEqual(['Website']);
		expect(grouped[0]?.total).toBe(2);
		expect(grouped[2]?.projects[0]?.name).toBe('Unfiled');
	});

	it('falls back to the file name for a project no longer in the index', () => {
		const grouped = groupCompletionsByArea(
			[entry('t-9', 'Old', '2026-07-02T10:00:00.000Z', 'P/Gone.md')],
			projects,
		);
		expect(grouped[0]?.projects[0]?.name).toBe('Gone');
	});
});

describe('selectRolledHighlights', () => {
	const reviews: Record<string, PeriodNote> = {
		'2026-W31': { highlights: ['t-1'], updatedAt: '' },
		'2026-W30': { highlights: ['t-4'], updatedAt: '' },
		'2026-07': { highlights: ['t-1', 't-3'], updatedAt: '' },
	};

	it('gathers highlights from the shorter periods inside a quarter', () => {
		const rolled = selectRolledHighlights('2026-Q3', reviews, log);
		expect(rolled.map((r) => r.entry.taskId)).toEqual(['t-1', 't-4', 't-3']);
	});

	it('deduplicates a task starred in both its week and its month', () => {
		const rolled = selectRolledHighlights('2026-Q3', reviews, log);
		expect(rolled.filter((r) => r.entry.taskId === 't-1')).toHaveLength(1);
		// ...attributed to the narrower period, which is the more precise claim.
		expect(rolled.find((r) => r.entry.taskId === 't-1')?.fromKey).toBe('2026-W31');
	});

	it('rolls nothing up into a week', () => {
		expect(selectRolledHighlights('2026-W31', reviews, log)).toEqual([]);
	});

	it('ignores a highlight whose completion is no longer in the log', () => {
		const stale = { '2026-W31': { highlights: ['t-gone'], updatedAt: '' } };
		expect(selectRolledHighlights('2026-Q3', stale, log)).toEqual([]);
	});
});

describe('buildReviewNote', () => {
	const completions = selectPeriodCompletions(log, '2026-W31');
	const note: PeriodNote = {
		highlights: ['t-1'],
		narrative: 'Pipeline work dominated.',
		focus: 'Get the migration to staging.',
		updatedAt: '',
	};
	const rendered = buildReviewNote({
		key: '2026-W31',
		note,
		completions,
		grouped: groupCompletionsByArea(completions, projects),
		rolled: [],
		projects,
	});

	it('leads with the period and its dates', () => {
		expect(rendered).toContain('# Review — Week 31');
		expect(rendered).toContain('*27 Jul – 2 Aug 2026*');
	});

	it('puts starred work under Highlights with its project', () => {
		expect(rendered).toContain('## Highlights\n\n- Shipped the staging pipeline — Website');
	});

	it('groups the rest by area with counts', () => {
		expect(rendered).toContain('### Platform — 2 completed');
		expect(rendered).toContain('**Website** — 2');
		expect(rendered).toContain('### Team — 1 completed');
	});

	it('carries the forward-looking and narrative sections', () => {
		expect(rendered).toContain('## Looking ahead\n\nGet the migration to staging.');
		expect(rendered).toContain('## Notes\n\nPipeline work dominated.');
	});

	it('omits empty sections rather than leaving bare headings', () => {
		const bare = buildReviewNote({
			key: '2026-W31',
			note: { highlights: [], updatedAt: '' },
			completions: [],
			grouped: [],
			rolled: [],
			projects,
		});
		expect(bare).not.toContain('## Highlights');
		expect(bare).not.toContain('## Looking ahead');
		expect(bare).toContain('_No completions recorded for this period._');
	});

	it('labels rolled-up highlights with the period they came from', () => {
		const withRolled = buildReviewNote({
			key: '2026-Q3',
			note: { highlights: [], updatedAt: '' },
			completions: [],
			grouped: [],
			rolled: [{ fromKey: '2026-W31', entry: log[0] as CompletionEntry }],
			projects,
		});
		expect(withRolled).toContain('- Shipped the staging pipeline — Website *(Week 31)*');
	});

	it('is plain markdown — nothing that needs the plugin to read it', () => {
		expect(rendered).not.toMatch(/\^t-|SCHEDULED:|:PROPERTIES:|%%/);
	});
});

describe('reviewNotePath', () => {
	it('places the note in the configured folder', () => {
		expect(reviewNotePath('2026-Q3', 'Reviews')).toBe('Reviews/Review 2026-Q3.md');
		expect(reviewNotePath('2026-W31', '')).toBe('Review 2026-W31.md');
		expect(reviewNotePath('2026-07', '/Notes/Reviews/')).toBe('Notes/Reviews/Review 2026-07.md');
	});
});
