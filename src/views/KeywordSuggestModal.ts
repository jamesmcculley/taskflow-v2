import { SuggestModal } from 'obsidian';
import type { App } from 'obsidian';
import { ALL_KEYWORDS } from '../org/keywords';
import type { OrgKeyword } from '../org/keywords';

const DESCRIPTIONS: Record<OrgKeyword, string> = {
	TODO: 'Open, not started',
	NEXT: 'The next action — surfaces in the NEXT list',
	WAITING: 'Blocked or delegated',
	SOMEDAY: 'Deferred; hidden from the agenda',
	DONE: 'Completed — writes CLOSED and logs it',
	CANCELLED: 'Abandoned — logged, no CLOSED stamp',
};

/** Picks a TODO keyword, org's `C-c C-t` with the full set spelled out. */
export class KeywordSuggestModal extends SuggestModal<OrgKeyword> {
	constructor(
		app: App,
		private onChoose: (keyword: OrgKeyword) => void,
	) {
		super(app);
		this.setPlaceholder('Set TODO keyword…');
	}

	getSuggestions(query: string): OrgKeyword[] {
		const q = query.toLowerCase();
		return ALL_KEYWORDS.filter((k) => k.toLowerCase().includes(q));
	}

	renderSuggestion(keyword: OrgKeyword, el: HTMLElement): void {
		el.createDiv({ text: keyword, cls: `tf2-keyword is-${keyword.toLowerCase()}` });
		el.createEl('small', { text: DESCRIPTIONS[keyword] });
	}

	onChooseSuggestion(keyword: OrgKeyword): void {
		this.onChoose(keyword);
	}
}
