/**
 * End-to-end tests: the REAL TaskActions + DailySync run against an in-memory
 * vault (obsidian module aliased to tests/mocks/obsidian.ts). A mini indexer
 * turns fixture markdown into store state; assertions check both the store
 * and the resulting markdown bytes.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeVault } from './mocks/obsidian';
import { parseCapture } from '../src/capture/parser';
import { DailySync } from '../src/daily/DailySync';
import { TaskActions } from '../src/mutations/actions';
import { insertTaskBlock } from '../src/mutations/blockEdits';
import { statusOf, priorityRank } from '../src/org/keywords';
import { isTaskHeadline, parseTaskAt } from '../src/org/parser';
import { editTaskBlock } from '../src/org/serialize';
import { dayName, inactiveStamp } from '../src/org/timestamp';
import { findStampDrift, findUnloggedCompletions, reconcileLog } from '../src/store/logReconcile';
import type { ExternalCompletionCandidate } from '../src/store/logReconcile';
import { addDaysISO, todayISO } from '../src/store/selectors';
import { createTaskFlowStore } from '../src/store/store';
import type TaskFlowPlugin from '../src/main';
import type { ProjectInfo, Task } from '../src/types';

const TODAY = todayISO();
const TOMORROW = addDaysISO(TODAY, 1);

/** The day name org writes into every timestamp, for building expectations. */
const dow = (iso: string) => dayName(iso);

interface Harness {
	plugin: TaskFlowPlugin;
	vault: FakeVault;
	actions: TaskActions;
	reindex: () => Promise<void>;
	fileContent: (path: string) => string;
	task: (id: string) => Task | undefined;
}

async function makeHarness(files: Record<string, string>): Promise<Harness> {
	const vault = new FakeVault();
	vault.seed(files);
	const store = createTaskFlowStore();
	const plugin = {
		app: { vault },
		store,
		persisted: {
			settings: {
				debugPerf: false,
				dailySync: true,
				dailySyncHeading: 'Completed',
				idStyle: 'blockref',
				excludedFolders: [],
				agendaSpan: 7,
				deadlineWarningDays: 14,
				showScheduledPast: true,
			},
			orders: {},
			completedAt: {},
			log: [],
			filters: [],
		},
		savePersisted: async () => undefined,
	} as unknown as TaskFlowPlugin;
	const actions = new TaskActions(plugin);
	const dailySync = new DailySync(plugin);
	(plugin as { actions: TaskActions }).actions = actions;
	(plugin as { dailySync: DailySync }).dailySync = dailySync;

	const indexFile = async (path: string) => {
		const content = vault.files.get(path) ?? '';
		const lines = content.split('\n');
		const fm: Record<string, string> = {};
		if (lines[0] === '---') {
			for (let i = 1; i < lines.length && lines[i] !== '---'; i++) {
				const m = /^(\w+):\s*(.+)$/.exec(lines[i] ?? '');
				if (m) fm[m[1] ?? ''] = m[2] ?? '';
			}
		}
		const isProject = fm.type === 'project';
		const project: ProjectInfo | null = isProject
			? {
					path,
					name: path.split('/').pop()?.replace(/\.md$/, '') ?? path,
					status: (fm.status as ProjectInfo['status']) ?? 'active',
					area: fm.area,
				}
			: null;
		let heading: string | undefined;
		const tasks: Task[] = [];
		const candidates: ExternalCompletionCandidate[] = [];
		for (let line = 0; line < lines.length; line++) {
			const raw = lines[line] ?? '';
			const h = /^#{1,6}\s+(.+?)\s*$/.exec(raw);
			if (h) heading = h[1];
			if (!isTaskHeadline(raw)) continue;
			const org = parseTaskAt(lines, line);
			if (!org?.blockId) continue;
			const taskProject = isProject ? path : undefined;
			const status = statusOf(org.keyword);
			const repeat = org.scheduled?.repeater ?? org.deadline?.repeater;
			tasks.push({
				id: org.blockId,
				title: org.title,
				file: path,
				line,
				blockEnd: org.end,
				keyword: org.keyword,
				status,
				scheduled: org.scheduled?.date,
				scheduledTime: org.scheduled?.time,
				due: org.deadline?.date,
				repeater: repeat ? `${repeat.kind}${repeat.value}${repeat.unit}` : undefined,
				tags: org.tags,
				project: taskProject,
				projectStatus: project?.status,
				heading,
				order: line,
				evening: org.tags.includes('tonight') || undefined,
				someday: org.keyword === 'SOMEDAY' || org.tags.includes('someday') || undefined,
				priority: priorityRank(org.priority),
				properties: Object.keys(org.properties).length > 0 ? org.properties : undefined,
				completedAt: plugin.persisted.completedAt[org.blockId],
			});
			if (status !== 'todo') {
				candidates.push({
					taskId: org.blockId,
					title: org.title,
					project: taskProject,
					status: status === 'cancelled' ? 'cancelled' : 'done',
					stampDate: org.closed?.date,
				});
			}
			line = org.end;
		}
		store.getState().setFileIndex(path, tasks, project);

		// Mirror the real indexer: prune log entries for tasks that reverted to
		// todo outside the plugin (a native uncheck), and remove their journal
		// lines too — the exact drift the user reported.
		const before = plugin.persisted.log;
		const pruned = reconcileLog(before, tasks);
		if (pruned) {
			const stillPresent = new Set(pruned);
			for (const entry of before) {
				if (!stillPresent.has(entry) && entry.status === 'done') await dailySync.remove(entry);
			}
			plugin.persisted.log = pruned;
			store.getState().setLog([...pruned]);
		}

		// Mirror the real indexer: notice done/cancelled tasks with no matching
		// History entry (a native checkbox click, hand-typed [x], etc.) and log
		// them the same way completing a task through the plugin would.
		const unlogged = findUnloggedCompletions(plugin.persisted.log, candidates);
		const needsStamp = new Set(
			unlogged.filter((c) => c.status === 'done' && c.stampDate === undefined).map((c) => c.taskId),
		);
		if (needsStamp.size > 0) {
			const today = todayISO();
			const stampLines = (vault.files.get(path) ?? '').split('\n');
			for (let i = stampLines.length - 1; i >= 0; i--) {
				if (!isTaskHeadline(stampLines[i] ?? '')) continue;
				const org = parseTaskAt(stampLines, i);
				if (org?.blockId === undefined || !needsStamp.has(org.blockId) || org.closed) continue;
				editTaskBlock(stampLines, i, 'blockref', (t) => {
					t.closed = inactiveStamp(today, '00:00');
				});
			}
			vault.files.set(path, stampLines.join('\n'));
		}
		for (const c of unlogged) await actions.recordExternalCompletion(c, c.stampDate ?? todayISO());

		// Mirror the real indexer: sync an already-logged completion's date to
		// a hand-edited ✅ stamp (markdown wins).
		const drift = findStampDrift(plugin.persisted.log, candidates);
		for (const d of drift) await actions.editCompletionDate(d.taskId, d.oldCompletedAt, d.newDateISO);
	};
	const reindex = async () => {
		for (const path of vault.files.keys()) if (path.endsWith('.md')) await indexFile(path);
	};
	await reindex();

	return {
		plugin,
		vault,
		actions,
		reindex,
		fileContent: (path) => vault.files.get(path) ?? '',
		task: (id) => store.getState().tasks[id],
	};
}

const INBOX = [
	'# Inbox',
	'',
	'- TODO Pay bill ^t-bill',
	'  DEADLINE: <2026-01-05 Mon>',
	'- TODO Call mom ^t-mom',
	'',
].join('\n');
const PROJECT = [
	'---',
	'type: project',
	'status: active',
	'---',
	'',
	'# Site',
	'',
	'## Design',
	'',
	'- TODO Moodboard ^t-mood',
	'',
	'## Build',
	'',
	'- TODO Weekly email ^t-mail',
	`  SCHEDULED: <${TODAY} ${dow(TODAY)} ++1w>`,
	'- TODO Deploy ^t-deploy',
	'',
].join('\n');

let h: Harness;
beforeEach(async () => {
	h = await makeHarness({ 'Inbox.md': INBOX, 'Projects/Site.md': PROJECT });
});

describe('e2e: completion lifecycle', () => {
	it('complete writes [x] + stamp, logs, and journals to the daily note', async () => {
		await h.actions.completeTask('t-mom');
		expect(h.fileContent('Inbox.md')).toContain('- DONE Call mom ^t-mom');
		expect(h.fileContent('Inbox.md')).toContain(`CLOSED: [${TODAY} ${dow(TODAY)}`);
		expect(h.plugin.persisted.log).toHaveLength(1);
		expect(h.plugin.persisted.log[0]).toMatchObject({ taskId: 't-mom', status: 'done' });
		const daily = h.fileContent(`${TODAY}.md`);
		expect(daily).toContain('## Completed');
		expect(daily).toContain('Call mom');
		expect(daily).toContain('%%t-mom%%');
	});

	it('uncomplete restores the line byte-for-byte and cleans log + journal', async () => {
		const before = h.fileContent('Inbox.md');
		await h.actions.completeTask('t-mom');
		await h.reindex();
		await h.actions.uncompleteTask('t-mom');
		expect(h.fileContent('Inbox.md')).toBe(before);
		expect(h.plugin.persisted.log).toHaveLength(0);
		expect(h.fileContent(`${TODAY}.md`)).not.toContain('%%t-mom%%');
	});

	it('recurring completion rewrites the line as the next occurrence', async () => {
		await h.actions.completeTask('t-mail');
		const content = h.fileContent('Projects/Site.md');
		const next = addDaysISO(TODAY, 7);
		expect(content).toContain('- TODO Weekly email ^t-mail');
		expect(content).toContain(`SCHEDULED: <${next} ${dow(next)} ++1w>`);
		expect(content).not.toContain('CLOSED:');
		// The occurrence is recorded in the LOGBOOK, org's own history drawer.
		expect(content).toContain(':LOGBOOK:');
		expect(content).toContain('State "DONE" from "TODO"');
		expect(h.plugin.persisted.log[0]).toMatchObject({ taskId: 't-mail', status: 'done' });
		expect(h.fileContent(`${TODAY}.md`)).toContain('Weekly email');
	});

	it('backdated completion stamps and journals on the chosen day', async () => {
		const asOf = addDaysISO(TODAY, -3);
		await h.actions.completeTask('t-mom', asOf);
		expect(h.fileContent('Inbox.md')).toContain(`CLOSED: [${asOf} ${dow(asOf)}`);
		expect(h.fileContent(`${asOf}.md`)).toContain('Call mom');
		expect(h.fileContent(`${TODAY}.md`)).toBe('');
		const entryDay = todayISO(new Date(h.plugin.persisted.log[0]?.completedAt ?? ''));
		expect(entryDay).toBe(asOf);
	});

	it('editCompletionDate corrects the ✅ stamp, log day, and journal placement', async () => {
		await h.actions.completeTask('t-mom');
		const original = h.plugin.persisted.log[0]!;
		const corrected = addDaysISO(TODAY, -2);
		await h.actions.editCompletionDate('t-mom', original.completedAt, corrected);

		expect(h.fileContent('Inbox.md')).toContain(`CLOSED: [${corrected} ${dow(corrected)}`);
		expect(h.plugin.persisted.log).toHaveLength(1);
		expect(todayISO(new Date(h.plugin.persisted.log[0]!.completedAt))).toBe(corrected);
		expect(h.fileContent(`${TODAY}.md`)).not.toContain('%%t-mom%%');
		expect(h.fileContent(`${corrected}.md`)).toContain('%%t-mom%%');

		await h.reindex();
		expect(h.task('t-mom')?.completedAt).toBe(h.plugin.persisted.log[0]!.completedAt);
	});

	it('editCompletionDate on a historical (non-live) entry only touches the log + journal', async () => {
		// A repeating task never keeps a CLOSED stamp — completing it advances
		// the headline back to TODO — so its completions are purely historical
		// from the moment they're recorded.
		await h.actions.completeTask('t-mail');
		const first = h.plugin.persisted.log[0]!;
		const before = h.fileContent('Projects/Site.md');
		const corrected = addDaysISO(TODAY, -10);

		await h.actions.editCompletionDate('t-mail', first.completedAt, corrected);

		expect(h.fileContent('Projects/Site.md')).toBe(before); // block untouched
		expect(todayISO(new Date(h.plugin.persisted.log[0]!.completedAt))).toBe(corrected);
		expect(h.fileContent(`${corrected}.md`)).toContain('Weekly email');
		expect(h.fileContent(`${TODAY}.md`)).not.toContain('Weekly email');
	});

	it('editCompletionDate ignores cancelled entries and unknown entries', async () => {
		await h.actions.cancelTask('t-mom');
		const cancelled = h.plugin.persisted.log[0]!;
		const before = [...h.plugin.persisted.log];
		await h.actions.editCompletionDate('t-mom', cancelled.completedAt, addDaysISO(TODAY, -1));
		expect(h.plugin.persisted.log).toEqual(before);

		const before2 = [...h.plugin.persisted.log];
		await h.actions.editCompletionDate('t-nope', new Date().toISOString(), TODAY);
		expect(h.plugin.persisted.log).toEqual(before2);
	});

	it('cancel writes CANCELLED with an index-only timestamp and no journal line', async () => {
		await h.actions.cancelTask('t-mom');
		expect(h.fileContent('Inbox.md')).toContain('- CANCELLED Call mom ^t-mom');
		expect(h.fileContent('Inbox.md')).not.toContain('CLOSED:');
		expect(h.plugin.persisted.log[0]?.status).toBe('cancelled');
		expect(h.fileContent(`${TODAY}.md`)).toBe('');
	});
});

describe('e2e: scheduling', () => {
	it('schedule today/tomorrow/clear round-trips the markdown', async () => {
		await h.actions.scheduleTask('t-mom', 'today');
		expect(h.fileContent('Inbox.md')).toContain(`SCHEDULED: <${TODAY} ${dow(TODAY)}>`);
		await h.reindex();
		await h.actions.scheduleTask('t-mom', 'tomorrow');
		expect(h.fileContent('Inbox.md')).toContain(`SCHEDULED: <${TOMORROW} ${dow(TOMORROW)}>`);
		await h.reindex();
		await h.actions.scheduleTask('t-mom', null);
		expect(h.fileContent('Inbox.md')).toContain('- TODO Call mom ^t-mom');
		expect(h.fileContent('Inbox.md')).not.toContain('SCHEDULED:');
	});

	it('rollOverdueToToday reschedules everything that slipped', async () => {
		const count = await h.actions.rollOverdueToToday();
		expect(count).toBe(1); // t-bill (deadline 2026-01-05)
		// Org's planning-line key order: DEADLINE before SCHEDULED, one line.
		expect(h.fileContent('Inbox.md')).toContain(
			`  DEADLINE: <2026-01-05 Mon> SCHEDULED: <${TODAY} ${dow(TODAY)}>`,
		);
	});

	it('reorderTasks scopes manual order to one list', async () => {
		await h.actions.reorderTasks('list:inbox', ['t-mom', 't-bill']);
		expect(h.plugin.persisted.orders['list:inbox']).toEqual({ 't-mom': 0, 't-bill': 1 });
		expect(h.plugin.persisted.orders['list:today']).toBeUndefined();
		expect(h.plugin.store.getState().orders['list:inbox']).toEqual({ 't-mom': 0, 't-bill': 1 });
	});

	it('setTaskPriority round-trips the token', async () => {
		await h.actions.setTaskPriority('t-mom', 1);
		expect(h.fileContent('Inbox.md')).toContain('- TODO [#A] Call mom ^t-mom');
		await h.reindex();
		expect(h.task('t-mom')?.priority).toBe(1);
		await h.actions.setTaskPriority('t-mom', null);
		expect(h.fileContent('Inbox.md')).toContain('- TODO Call mom ^t-mom');
	});
});

describe('e2e: moving tasks', () => {
	it('moveToProject moves the line under the target heading', async () => {
		await h.actions.moveToProject('t-mom', 'Projects/Site.md', 'Design');
		expect(h.fileContent('Inbox.md')).not.toContain('t-mom');
		const project = h.fileContent('Projects/Site.md');
		const design = project.slice(project.indexOf('## Design'), project.indexOf('## Build'));
		expect(design).toContain('- TODO Call mom ^t-mom');
	});



	it('toggleSomeday (board drop onto the Someday column) writes the SOMEDAY keyword', async () => {
		await h.actions.toggleSomeday('t-mood');
		expect(h.fileContent('Projects/Site.md')).toContain('- SOMEDAY Moodboard ^t-mood');
		await h.reindex();
		expect(h.task('t-mood')?.someday).toBe(true);
	});

	it('toggleSomeday off returns the keyword to TODO', async () => {
		await h.actions.toggleSomeday('t-mood');
		await h.reindex();
		await h.actions.toggleSomeday('t-mood');
		expect(h.fileContent('Projects/Site.md')).toContain('- TODO Moodboard ^t-mood');
		await h.reindex();
		expect(h.task('t-mood')?.someday).toBeUndefined();
	});
});

// v1 encoded task-level Someday as a `:someday:` tag. v2 writes the SOMEDAY
// keyword instead, but has to keep reading the tag so migrated and hand-written
// vaults don't silently lose the state.
describe('e2e: legacy :someday: tag', () => {
	it('still indexes as Someday', async () => {
		h.vault.seed({ 'Old.md': '- TODO Learn welding :someday: ^t-weld\n' });
		await h.reindex();
		expect(h.task('t-weld')?.someday).toBe(true);
	});

	it('toggling off strips the tag without clobbering a NEXT/WAITING keyword', async () => {
		h.vault.seed({ 'Old.md': '- WAITING Hear back :someday: ^t-wait\n' });
		await h.reindex();
		await h.actions.toggleSomeday('t-wait');
		const content = h.fileContent('Old.md');
		expect(content).toContain('- WAITING Hear back ^t-wait');
		expect(content).not.toContain(':someday:');
		await h.reindex();
		expect(h.task('t-wait')?.someday).toBeUndefined();
		expect(h.task('t-wait')?.keyword).toBe('WAITING');
	});

	it('toggling on replaces the tag with the keyword, not both', async () => {
		h.vault.seed({ 'Old.md': '- TODO Learn welding ^t-weld2\n' });
		await h.reindex();
		await h.actions.toggleSomeday('t-weld2');
		const content = h.fileContent('Old.md');
		expect(content).toContain('- SOMEDAY Learn welding ^t-weld2');
		expect(content).not.toContain(':someday:');
	});
});

describe('e2e: checklist toggle', () => {
	it('toggles a child line by block id', async () => {
		h.vault.seed({
			'List.md': ['- TODO Parent ^t-parent', '\t- [ ] Child ^t-child', ''].join('\n'),
		});
		await h.reindex();
		h.plugin.store.getState().patchTask('t-parent', {
			checklist: [{ id: 't-child', title: 'Child', done: false, line: 1 }],
		});
		await h.actions.toggleChecklistItem('t-parent', 't-child');
		expect(h.fileContent('List.md')).toContain('\t- [x] Child ^t-child');
	});
});

describe('e2e: completions made outside the plugin', () => {
	// Reproduces the real bug: a task checked off via Obsidian's own native
	// checkbox (or hand-typed [x], or synced in from elsewhere) never runs
	// completeTask, so nothing ever logged it — History silently missed it.
	it('a hand-typed DONE (no CLOSED stamp, no prior log entry) gets stamped and logged on reindex', async () => {
		h.vault.seed({
			'Notes.md': '- TODO Water the plants ^t-native\n',
		});
		await h.reindex();
		// Simulate typing DONE over TODO in the note: nothing else changes.
		h.vault.seed({
			'Notes.md': '- DONE Water the plants ^t-native\n',
		});
		await h.reindex();

		expect(h.fileContent('Notes.md')).toContain('- DONE Water the plants ^t-native');
		expect(h.fileContent('Notes.md')).toContain(`CLOSED: [${TODAY} ${dow(TODAY)}`);
		const entry = h.plugin.persisted.log.find((e) => e.taskId === 't-native');
		expect(entry).toMatchObject({ taskId: 't-native', status: 'done' });
		expect(h.fileContent(`${TODAY}.md`)).toContain('Water the plants');
	});

	it('an already-stamped external completion is logged using its own date, not today', async () => {
		const past = addDaysISO(TODAY, -5);
		h.vault.seed({
			'Notes.md': `- DONE Old item ^t-old\n  CLOSED: [${past} ${dow(past)} 09:00]\n`,
		});
		await h.reindex();

		const entry = h.plugin.persisted.log.find((e) => e.taskId === 't-old');
		expect(todayISO(new Date(entry!.completedAt))).toBe(past);
		expect(h.fileContent(`${past}.md`)).toContain('Old item');
	});

	it('does not re-log a completion the plugin already recorded itself', async () => {
		await h.actions.completeTask('t-mom');
		const before = h.plugin.persisted.log.length;
		await h.reindex();
		await h.reindex();
		expect(h.plugin.persisted.log).toHaveLength(before);
	});

	it('a hand-typed DONE on a repeating task logs it (with a stamp) without auto-advancing', async () => {
		// Typing DONE bypasses completeTask(), the only path that knows how to
		// advance a repeater — so the stamp stays put, but it still earns the
		// same CLOSED stamp any other done task would.
		h.vault.seed({
			'Notes.md': `- DONE Feed the cat ^t-cat\n  SCHEDULED: <${TODAY} ${dow(TODAY)} ++1d>\n`,
		});
		await h.reindex();

		expect(h.fileContent('Notes.md')).toBe(
			[
				'- DONE Feed the cat ^t-cat',
				`  CLOSED: [${TODAY} ${dow(TODAY)} 00:00] SCHEDULED: <${TODAY} ${dow(TODAY)} ++1d>`,
				'',
			].join('\n'),
		);
		const entry = h.plugin.persisted.log.find((e) => e.taskId === 't-cat');
		expect(entry).toMatchObject({ taskId: 't-cat', status: 'done' });
	});

	it('hand-editing an already-logged CLOSED stamp syncs History and moves the daily journal line', async () => {
		await h.actions.completeTask('t-mom'); // logged for TODAY, journaled to TODAY's note
		const corrected = addDaysISO(TODAY, -4);

		// Hand-edit the stamp directly in the note — not through any plugin action.
		const edited = h
			.fileContent('Inbox.md')
			.replace(`CLOSED: [${TODAY} ${dow(TODAY)}`, `CLOSED: [${corrected} ${dow(corrected)}`);
		h.vault.seed({ 'Inbox.md': edited });
		await h.reindex();

		const entry = h.plugin.persisted.log.find((e) => e.taskId === 't-mom');
		expect(todayISO(new Date(entry!.completedAt))).toBe(corrected);
		expect(h.fileContent(`${TODAY}.md`)).not.toContain('%%t-mom%%');
		expect(h.fileContent(`${corrected}.md`)).toContain('%%t-mom%%');
	});

	it('does not re-sync once the log already matches the stamp', async () => {
		await h.actions.completeTask('t-mom');
		const before = h.plugin.persisted.log[0]!.completedAt;
		await h.reindex();
		await h.reindex();
		expect(h.plugin.persisted.log[0]!.completedAt).toBe(before);
	});

	it('hand-reverting DONE to TODO removes History AND the journal line', async () => {
		await h.actions.completeTask('t-mom'); // logged + journaled to TODAY's note
		// Simulate editing the note by hand, bypassing uncompleteTask entirely.
		const reverted = h
			.fileContent('Inbox.md')
			.replace('- DONE Call mom', '- TODO Call mom')
			.replace(/^\s*CLOSED:.*\n/m, '');
		h.vault.seed({ 'Inbox.md': reverted });
		await h.reindex();

		expect(h.plugin.persisted.log.find((e) => e.taskId === 't-mom')).toBeUndefined();
		expect(h.fileContent(`${TODAY}.md`)).not.toContain('%%t-mom%%');
	});

	it('removeLogEntry (History → Remove) also removes the journal line', async () => {
		await h.actions.completeTask('t-mom');
		const entry = h.plugin.persisted.log[0]!;
		await h.actions.removeLogEntry(entry.taskId, entry.completedAt);
		expect(h.plugin.persisted.log).toHaveLength(0);
		expect(h.fileContent(`${TODAY}.md`)).not.toContain('%%t-mom%%');
	});

	it('cleanOrphanedJournalLines repairs pre-existing drift without touching valid lines', async () => {
		await h.actions.completeTask('t-mom'); // valid: still logged
		await h.actions.completeTask('t-bill'); // will become orphaned below

		// Simulate drift that predates the fix: strip t-bill's log entry
		// directly, leaving its journal line behind (what the old, buggy
		// reconcilePersisted path used to do).
		h.plugin.persisted.log = h.plugin.persisted.log.filter((e) => e.taskId !== 't-bill');
		h.plugin.store.getState().setLog([...h.plugin.persisted.log]);
		expect(h.fileContent(`${TODAY}.md`)).toContain('%%t-bill%%');

		await h.plugin.dailySync.cleanOrphanedJournalLines();

		expect(h.fileContent(`${TODAY}.md`)).not.toContain('%%t-bill%%');
		expect(h.fileContent(`${TODAY}.md`)).toContain('%%t-mom%%'); // untouched
	});

	it('cleanOrphanedJournalLines never touches an unrelated %%…%% comment', async () => {
		h.vault.seed({
			'Journal.md': ['# Notes', '', '%% a private comment %%', ''].join('\n'),
		});
		await h.plugin.dailySync.cleanOrphanedJournalLines();
		expect(h.fileContent('Journal.md')).toContain('%% a private comment %%');
	});
});

describe('e2e: capture pipeline', () => {
	it('parse → render → insert lands a full org block in the inbox', () => {
		const parse = parseCapture('Buy paint tomorrow !! every week #home', new Date());
		const block = h.actions.renderNewTask({
			title: parse.title,
			keyword: parse.keyword,
			priority: parse.priority,
			scheduled: parse.scheduled,
			scheduledTime: parse.scheduledTime,
			due: parse.due,
			repeater: parse.repeater,
			ruleText: parse.ruleText,
			tags: parse.tags,
		});
		const content = insertTaskBlock(h.fileContent('Inbox.md'), block);
		const lines = content.trimEnd().split('\n');
		const start = lines.length - block.length;
		const reparsed = parseTaskAt(lines, start);
		expect(reparsed?.title).toBe('Buy paint');
		expect(reparsed?.keyword).toBe('TODO');
		expect(reparsed?.priority).toBe('B');
		expect(reparsed?.scheduled?.date).toBe(TOMORROW);
		expect(reparsed?.scheduled?.repeater).toEqual({ kind: '++', value: 1, unit: 'w' });
		expect(reparsed?.tags).toEqual(['home']);
	});

	it('a capture with an unrepresentable repeat keeps its rrule in :REPEAT:', () => {
		const parse = parseCapture('Rent check every 3rd friday', new Date());
		const block = h.actions.renderNewTask({
			title: parse.title,
			keyword: parse.keyword,
			ruleText: parse.ruleText,
			scheduled: parse.scheduled,
		});
		const org = parseTaskAt(block, 0);
		expect(org?.properties.REPEAT).toBe('every 3rd friday');
	});
});
