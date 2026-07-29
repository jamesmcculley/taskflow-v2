import { ItemView } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type TaskFlowPlugin from '../main';
import { App } from './App';

// Must not collide with v1's ids: Obsidian's registerView throws outright if a
// view type is already registered, so sharing 'taskflow-view' with v1 made v2
// fail to load whenever v1 was enabled in the same vault. These are Obsidian
// registry ids, not CSS classes — they keep the plugin-id spelling rather than
// the stylesheet's `tf2-` prefix.
export const VIEW_TYPE_TASKFLOW = 'taskflow-v2-view';
export const HOVER_SOURCE_TASKFLOW = 'taskflow-v2';

export class TaskFlowView extends ItemView {
	private root: Root | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: TaskFlowPlugin,
	) {
		super(leaf);
	}

	override getViewType(): string {
		return VIEW_TYPE_TASKFLOW;
	}

	override getDisplayText(): string {
		return 'TaskFlow';
	}

	override getIcon(): string {
		return 'check-square';
	}

	override async onOpen(): Promise<void> {
		this.contentEl.addClass('tf2-view');
		this.root = createRoot(this.contentEl);
		this.root.render(<App plugin={this.plugin} view={this} />);
	}

	override async onClose(): Promise<void> {
		this.root?.unmount();
		this.root = null;
	}
}
