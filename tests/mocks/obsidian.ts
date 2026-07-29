/**
 * Minimal obsidian API mock so the real mutation layer (TaskActions,
 * DailySync) can run end-to-end in vitest against an in-memory vault.
 */

export class TAbstractFile {
	constructor(public path: string) {}
}

export class TFile extends TAbstractFile {
	extension = 'md';
	get basename(): string {
		return this.path.split('/').pop()?.replace(/\.md$/, '') ?? this.path;
	}
}

export class Notice {
	static messages: string[] = [];
	constructor(message?: string) {
		if (message) Notice.messages.push(message);
	}
}

export const normalizePath = (p: string): string => p.replace(/\/{2,}/g, '/').replace(/^\//, '');

export const moment = (input: Date) => ({
	format: (fmt: string) => {
		const pad = (n: number) => String(n).padStart(2, '0');
		return fmt
			.replace('YYYY', String(input.getFullYear()))
			.replace('MM', pad(input.getMonth() + 1))
			.replace('DD', pad(input.getDate()));
	},
});

// Referenced by view modules if they ever get imported in tests.
export class Menu {}
export class Modal {}
export class PluginSettingTab {}
export class Setting {}
export class SuggestModal {}
export class FuzzySuggestModal {}
export class Plugin {}
export const setIcon = (): void => undefined;

/** In-memory vault matching the subset of the API the plugin uses. */
export class FakeVault {
	files = new Map<string, string>();
	private handles = new Map<string, TFile>();

	private handle(path: string): TFile {
		let h = this.handles.get(path);
		if (!h) {
			h = new TFile(path);
			this.handles.set(path, h);
		}
		return h;
	}

	seed(files: Record<string, string>): void {
		for (const [path, content] of Object.entries(files)) this.files.set(path, content);
	}

	getAbstractFileByPath(path: string): TFile | null {
		return this.files.has(path) ? this.handle(path) : null;
	}

	getMarkdownFiles(): TFile[] {
		return [...this.files.keys()].filter((p) => p.endsWith('.md')).map((p) => this.handle(p));
	}

	async process(file: TFile, fn: (content: string) => string): Promise<string> {
		const next = fn(this.files.get(file.path) ?? '');
		this.files.set(file.path, next);
		return next;
	}

	async read(file: TFile): Promise<string> {
		return this.files.get(file.path) ?? '';
	}

	async cachedRead(file: TFile): Promise<string> {
		return this.read(file);
	}

	async create(path: string, content: string): Promise<TFile> {
		this.files.set(path, content);
		return this.handle(path);
	}

	async modify(file: TFile, content: string): Promise<void> {
		this.files.set(file.path, content);
	}

	async createFolder(_path: string): Promise<void> {
		/* folders are implicit in the fake */
	}
}
