import { SuggestModal } from 'obsidian';
import type TaskFlowPlugin from '../main';
import type { Route } from '../store/store';

interface DispatchEntry {
	/** The single key org's dispatcher binds this to. */
	key: string;
	label: string;
	description: string;
	route: Route;
	/** Agenda span to apply when this entry opens the agenda. */
	span?: number;
}

/**
 * Org's agenda dispatcher (`C-c a`): one keystroke per view. The keys match
 * org's own bindings where org has one — `a` agenda, `t` all TODOs, `d` day,
 * `T` a keyword-filtered list — so muscle memory carries over.
 */
const ENTRIES: DispatchEntry[] = [
	{ key: 'a', label: 'Agenda for the week', description: 'SCHEDULED and DEADLINE items, 7 days', route: { kind: 'agenda' }, span: 7 },
	{ key: 'd', label: 'Agenda for today', description: 'Just today', route: { kind: 'agenda' }, span: 1 },
	{ key: 'w', label: 'Agenda for the fortnight', description: '14 days', route: { kind: 'agenda' }, span: 14 },
	{ key: 't', label: 'All open tasks', description: 'Every TODO, ignoring dates', route: { kind: 'list', list: 'whenever' } },
	{ key: 'n', label: 'NEXT actions', description: 'Tasks marked NEXT', route: { kind: 'list', list: 'next' } },
	{ key: 'W', label: 'WAITING on', description: 'Blocked or delegated tasks', route: { kind: 'list', list: 'waiting' } },
	{ key: 'i', label: 'Inbox', description: 'Unfiled, undated tasks', route: { kind: 'list', list: 'inbox' } },
	{ key: 'u', label: 'Upcoming', description: 'Dated after today, grouped by day', route: { kind: 'list', list: 'upcoming' } },
	{ key: 's', label: 'Someday', description: 'Deferred tasks and projects', route: { kind: 'list', list: 'someday' } },
	{ key: 'l', label: 'History', description: 'The completion log, newest first', route: { kind: 'list', list: 'history' } },
	{ key: 'R', label: 'Weekly review', description: 'Guided Inbox → projects → Someday pass', route: { kind: 'review' } },
];

export class AgendaDispatchModal extends SuggestModal<DispatchEntry> {
	constructor(private plugin: TaskFlowPlugin) {
		super(plugin.app);
		this.setPlaceholder('Agenda dispatcher — press a key or type to filter');
	}

	getSuggestions(query: string): DispatchEntry[] {
		const q = query.trim();
		// A bare single character is treated as org's key binding, so typing
		// "a" jumps straight to the weekly agenda instead of fuzzy-matching.
		if (q.length === 1) {
			const exact = ENTRIES.filter((e) => e.key === q);
			if (exact.length > 0) return exact;
		}
		const lower = q.toLowerCase();
		return ENTRIES.filter(
			(e) => e.label.toLowerCase().includes(lower) || e.description.toLowerCase().includes(lower),
		);
	}

	renderSuggestion(entry: DispatchEntry, el: HTMLElement): void {
		el.addClass('tf2-dispatch-item');
		el.createSpan({ text: entry.key, cls: 'tf2-dispatch-key' });
		const body = el.createDiv();
		body.createDiv({ text: entry.label });
		body.createEl('small', { text: entry.description });
	}

	onChooseSuggestion(entry: DispatchEntry): void {
		const state = this.plugin.store.getState();
		if (entry.span !== undefined) {
			state.setAgendaSpan(entry.span);
			state.setAgendaStart(null);
		}
		state.setRoute(entry.route);
		void this.plugin.activateView();
	}
}
