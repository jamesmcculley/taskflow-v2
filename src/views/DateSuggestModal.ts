import { SuggestModal } from 'obsidian';
import type { App } from 'obsidian';
import { buildDateSuggestions } from './dateSuggestions';
import type { DateSuggestion } from './dateSuggestions';

/** "When" date picker: quick options + natural-language date entry. */
export class DateSuggestModal extends SuggestModal<DateSuggestion> {
	constructor(
		app: App,
		title: string,
		private allowClear: boolean,
		private onChoose: (date: string | null) => void,
	) {
		super(app);
		this.setPlaceholder(`${title} — today, friday, aug 3, in 2 weeks, 2026-07-01…`);
		this.emptyStateText = 'No date recognized.';
	}

	override getSuggestions(query: string): DateSuggestion[] {
		return buildDateSuggestions(query, { allowClear: this.allowClear });
	}

	override renderSuggestion(suggestion: DateSuggestion, el: HTMLElement): void {
		el.createDiv({ text: suggestion.label });
		if (suggestion.detail) {
			el.createDiv({ cls: 'tf2-date-detail', text: suggestion.detail });
		}
	}

	override onChooseSuggestion(suggestion: DateSuggestion): void {
		this.onChoose(suggestion.date);
	}
}
