import { Modal, Notice } from 'obsidian';
import type TaskFlowPlugin from '../main';
import { insertTaskBlock } from '../mutations/blockEdits';
import type { ProjectInfo } from '../types';
import { parseCapture } from './parser';
import type { CaptureParse } from './parser';

function resolveProject(query: string, projects: ProjectInfo[]): ProjectInfo | undefined {
	const q = query.toLowerCase();
	return (
		projects.find((p) => p.name.toLowerCase() === q) ??
		projects.find((p) => p.name.toLowerCase().startsWith(q)) ??
		projects.find((p) => p.name.toLowerCase().includes(q))
	);
}

export interface CaptureDefaults {
	/** Pre-targeted destination (e.g. the project view the plus button was pressed in). */
	destPath?: string;
	destLabel?: string;
	/** Applied when the input contains no date of its own (e.g. Today view). */
	scheduled?: string;
}

export class CaptureModal extends Modal {
	private parse: CaptureParse = { title: '', keyword: 'TODO', tags: [] };

	constructor(
		private plugin: TaskFlowPlugin,
		private defaults: CaptureDefaults = {},
	) {
		super(plugin.app);
	}

	override onOpen(): void {
		this.modalEl.addClass('tf2-capture-modal');
		this.titleEl.setText('Quick capture');

		const input = this.contentEl.createEl('input', {
			type: 'text',
			cls: 'tf2-capture-input',
			attr: { placeholder: 'Buy paint tomorrow #home !due friday >Home Renovation' },
		});
		const preview = this.contentEl.createDiv({ cls: 'tf2-capture-preview' });
		const hint = this.contentEl.createDiv({ cls: 'tf2-capture-hint' });
		hint.setText('Enter to capture · natural dates schedule · !due <date> · >Project · #tags');

		const renderPreview = () => {
			this.parse = parseCapture(input.value);
			preview.empty();
			if (input.value.trim() === '') return;
			const row = (label: string, value: string) => {
				const el = preview.createDiv({ cls: 'tf2-capture-row' });
				el.createSpan({ cls: 'tf2-capture-label', text: label });
				el.createSpan({ text: value });
			};
			row('Task', this.parse.title || '—');
			row('Keyword', this.parse.keyword);
			if (this.parse.priority) row('Priority', `[#${'ABC'[this.parse.priority - 1]}]`);
			if (this.parse.scheduled)
				row('SCHEDULED', this.parse.scheduled + (this.parse.scheduledTime ? ` ${this.parse.scheduledTime}` : ''));
			if (this.parse.due) row('DEADLINE', this.parse.due);
			if (this.parse.repeater) row('Repeat', this.parse.repeater);
			if (this.parse.ruleText) row('Repeat', `:REPEAT: ${this.parse.ruleText}`);
			if (this.parse.tags.length > 0) row('Tags', `:${this.parse.tags.join(':')}:`);
			row('To', this.destinationLabel());

			// The block is rendered by the same serializer that writes the file,
			// so what the preview shows is literally what lands in the note.
			const block = preview.createEl('pre', { cls: 'tf2-capture-block' });
			block.setText(this.renderBlock().join('\n'));
		};

		input.addEventListener('input', renderPreview);
		input.addEventListener('keydown', (e) => {
			// isComposing: don't submit mid-IME-composition (CJK input).
			if (e.key === 'Enter' && !e.isComposing) {
				e.preventDefault();
				void this.submit();
			}
		});
		input.focus();
	}

	private destination(): { path: string; label: string } {
		if (this.parse.projectQuery) {
			const projects = Object.values(this.plugin.store.getState().projects);
			const match = resolveProject(this.parse.projectQuery, projects);
			if (match) return { path: match.path, label: match.name };
		}
		if (this.defaults.destPath) {
			return { path: this.defaults.destPath, label: this.defaults.destLabel ?? this.defaults.destPath };
		}
		return { path: 'Inbox.md', label: 'Inbox' };
	}

	private destinationLabel(): string {
		const dest = this.destination();
		if (this.parse.projectQuery && dest.path === 'Inbox.md') {
			return `Inbox (no project matches “${this.parse.projectQuery}”)`;
		}
		return dest.label;
	}

	/** The org block this capture will write, via the plugin's own serializer. */
	private renderBlock(): string[] {
		return this.plugin.actions.renderNewTask({
			title: this.parse.title,
			keyword: this.parse.keyword,
			priority: this.parse.priority,
			scheduled: this.parse.scheduled ?? this.defaults.scheduled,
			scheduledTime: this.parse.scheduledTime,
			due: this.parse.due,
			repeater: this.parse.repeater,
			ruleText: this.parse.ruleText,
			tags: this.parse.tags,
		});
	}

	private async submit(): Promise<void> {
		if (this.parse.title.trim() === '') return;
		const dest = this.destination();
		if (this.parse.scheduled === undefined && this.defaults.scheduled !== undefined) {
			this.parse = { ...this.parse, scheduled: this.defaults.scheduled };
		}
		const block = this.renderBlock();
		const file = await this.plugin.actions.ensureFile(dest.path);
		await this.plugin.app.vault.process(file, (content) => insertTaskBlock(content, block));
		new Notice(`Captured to ${dest.label}: ${this.parse.title}`);
		this.close();
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
