import { Modal, Setting } from 'obsidian';
import type TaskFlowPlugin from '../main';
import { ALL_KEYWORDS } from '../org/keywords';
import type { OrgKeyword } from '../org/keywords';
import type { FilterDate, SavedFilter } from '../types';

const DATE_OPTIONS: Record<FilterDate, string> = {
	any: 'Any date',
	overdue: 'Overdue',
	today: 'Today or earlier',
	'this-week': 'This week or earlier',
	none: 'No date',
	'has-date': 'Has a date',
};

function newFilterId(): string {
	return `f-${Math.random().toString(36).slice(2, 8)}`;
}

/** Create/edit form for a pinned filter. */
export class FilterModal extends Modal {
	private draft: SavedFilter;

	constructor(
		private plugin: TaskFlowPlugin,
		existing?: SavedFilter,
	) {
		super(plugin.app);
		this.draft = existing
			? { ...existing, tags: existing.tags ? [...existing.tags] : undefined }
			: { id: newFilterId(), name: '' };
	}

	override onOpen(): void {
		this.titleEl.setText(this.draft.name === '' ? 'New filter' : 'Edit filter');
		const { contentEl } = this;

		new Setting(contentEl).setName('Name').addText((t) =>
			t.setValue(this.draft.name).onChange((v) => {
				this.draft.name = v;
			}),
		);
		// One toggle per keyword; leaving them all off means "any keyword",
		// which is what an unset criterion means everywhere else in a filter.
		const keywords = new Set<OrgKeyword>(this.draft.keywords ?? []);
		const keywordSetting = new Setting(contentEl)
			.setName('Keywords')
			.setDesc('Match any of the selected keywords. None selected = any keyword.');
		for (const keyword of ALL_KEYWORDS) {
			keywordSetting.addButton((b) => {
				const paint = () => b.setClass(keywords.has(keyword) ? 'mod-cta' : 'tf2-filter-keyword-off');
				b.setButtonText(keyword);
				paint();
				b.onClick(() => {
					if (keywords.has(keyword)) keywords.delete(keyword);
					else keywords.add(keyword);
					this.draft.keywords = keywords.size > 0 ? [...keywords] : undefined;
					b.buttonEl.toggleClass('mod-cta', keywords.has(keyword));
				});
			});
		}

		new Setting(contentEl)
			.setName('Tags')
			.setDesc('Space or comma separated; every tag must match.')
			.addText((t) =>
				t.setValue(this.draft.tags?.join(' ') ?? '').onChange((v) => {
					const tags = v
						.split(/[\s,]+/)
						.map((s) => s.replace(/^#/, '').trim())
						.filter((s) => s !== '');
					this.draft.tags = tags.length > 0 ? tags : undefined;
				}),
			);
		new Setting(contentEl).setName('Project').addText((t) =>
			t.setValue(this.draft.project ?? '').onChange((v) => {
				this.draft.project = v.trim() || undefined;
			}),
		);
		new Setting(contentEl).setName('Area').addText((t) =>
			t.setValue(this.draft.area ?? '').onChange((v) => {
				this.draft.area = v.trim() || undefined;
			}),
		);
		new Setting(contentEl).setName('Date').addDropdown((d) => {
			for (const [value, label] of Object.entries(DATE_OPTIONS)) d.addOption(value, label);
			d.setValue(this.draft.date ?? 'any').onChange((v) => {
				this.draft.date = v === 'any' ? undefined : (v as FilterDate);
			});
		});
		new Setting(contentEl).setName('Title contains').addText((t) =>
			t.setValue(this.draft.text ?? '').onChange((v) => {
				this.draft.text = v.trim() || undefined;
			}),
		);

		new Setting(contentEl).addButton((b) =>
			b
				.setButtonText('Save')
				.setCta()
				.onClick(() => {
					if (this.draft.name.trim() === '') return;
					this.draft.name = this.draft.name.trim();
					void this.plugin.actions.saveFilter(this.draft).then(() => {
						this.plugin.store.getState().setRoute({ kind: 'filter', id: this.draft.id });
						this.close();
					});
				}),
		);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
