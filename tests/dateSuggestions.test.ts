import { describe, expect, it } from 'vitest';
import { buildDateSuggestions } from '../src/views/dateSuggestions';

// Sat 2026-07-18, noon local.
const NOW = new Date(2026, 6, 18, 12, 0, 0);

describe('buildDateSuggestions', () => {
	it('empty query offers Today, Tomorrow, Next week', () => {
		const s = buildDateSuggestions('', { allowClear: false, now: NOW });
		expect(s.map((x) => [x.label, x.date])).toEqual([
			['Today', '2026-07-18'],
			['Tomorrow', '2026-07-19'],
			['Next week', '2026-07-20'],
		]);
	});

	it('includes Clear date when allowed', () => {
		const s = buildDateSuggestions('', { allowClear: true, now: NOW });
		expect(s[s.length - 1]).toEqual({ label: 'Clear date', date: null });
	});

	it('parses natural language forward', () => {
		const s = buildDateSuggestions('in 2 weeks', { allowClear: false, now: NOW });
		expect(s[0]?.date).toBe('2026-08-01');
	});

	it('parses explicit past dates', () => {
		const s = buildDateSuggestions('yesterday', { allowClear: false, now: NOW });
		expect(s[0]?.date).toBe('2026-07-17');
		expect(s[0]?.detail).toContain('past');
	});

	it('parses ISO dates', () => {
		const s = buildDateSuggestions('2026-12-24', { allowClear: false, now: NOW });
		expect(s[0]?.date).toBe('2026-12-24');
	});

	it('returns nothing for unparseable text', () => {
		expect(buildDateSuggestions('nonsense here', { allowClear: false, now: NOW })).toEqual([]);
	});
});
