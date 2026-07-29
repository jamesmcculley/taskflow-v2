import * as chrono from 'chrono-node';
import { addDaysISO, todayISO } from '../store/selectors';

export interface DateSuggestion {
	label: string;
	detail?: string;
	/** null = clear the date. */
	date: string | null;
}

function formatLong(iso: string, today: string): string {
	const [y, m, d] = iso.split('-').map(Number);
	const dt = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
	return dt.toLocaleDateString(undefined, {
		weekday: 'long',
		month: 'short',
		day: 'numeric',
		...(iso.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }),
	});
}

/**
 * Suggestions for the date picker. Empty query → quick options; otherwise
 * chrono parses the text (forward-biased for ambiguous phrases, but explicit
 * past dates like "yesterday" or "last friday" resolve to the past).
 */
export function buildDateSuggestions(
	query: string,
	opts: { allowClear: boolean; now?: Date },
): DateSuggestion[] {
	const now = opts.now ?? new Date();
	const today = todayISO(now);
	const q = query.trim();

	if (q === '') {
		const daysToNextMonday = ((1 - now.getDay()) % 7 + 7) % 7 || 7;
		const quick: DateSuggestion[] = [
			{ label: 'Today', detail: formatLong(today, today), date: today },
			{ label: 'Tomorrow', detail: formatLong(addDaysISO(today, 1), today), date: addDaysISO(today, 1) },
			{
				label: 'Next week',
				detail: formatLong(addDaysISO(today, daysToNextMonday), today),
				date: addDaysISO(today, daysToNextMonday),
			},
		];
		if (opts.allowClear) quick.push({ label: 'Clear date', date: null });
		return quick;
	}

	const results = chrono.casual.parse(q, now, { forwardDate: true });
	const seen = new Set<string>();
	const suggestions: DateSuggestion[] = [];
	for (const r of results) {
		const iso = todayISO(r.start.date());
		if (seen.has(iso)) continue;
		seen.add(iso);
		suggestions.push({
			label: formatLong(iso, today),
			detail: iso < today ? `${iso} · past` : iso,
			date: iso,
		});
	}
	return suggestions;
}
