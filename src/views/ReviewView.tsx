import { Notice, TFile } from 'obsidian';
import { useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import type TaskFlowPlugin from '../main';
import {
	periodDateRangeLabel,
	periodKeyFor,
	periodLabel,
	periodRange,
	shiftPeriodKey,
} from '../store/period';
import type { PeriodKind } from '../store/period';
import {
	buildReviewNote,
	groupCompletionsByArea,
	reviewNotePath,
	selectLooseEnds,
	selectPeriodCompletions,
	selectRolledHighlights,
} from '../store/review';
import { todayISO } from '../store/selectors';
import type { PeriodNote } from '../types';
import { ObsidianIcon } from './components/ObsidianIcon';

const KINDS: { kind: PeriodKind; label: string }[] = [
	{ kind: 'week', label: 'Week' },
	{ kind: 'month', label: 'Month' },
	{ kind: 'quarter', label: 'Quarter' },
];

const EMPTY_NOTE: PeriodNote = { highlights: [], updatedAt: '' };

/**
 * Looking back and looking ahead over one period.
 *
 * The star is the whole design. Marking a completion as a highlight takes one
 * click in the week you did it, and it carries upward — so the month and the
 * quarter are already written by the time you get there, instead of being
 * reconstructed from a log you can no longer interpret.
 */
export function ReviewView({ plugin }: { plugin: TaskFlowPlugin }) {
	const tasks = useStore(plugin.store, (s) => s.tasks);
	const projects = useStore(plugin.store, (s) => s.projects);
	const log = useStore(plugin.store, (s) => s.log);
	const today = todayISO();

	const [kind, setKind] = useState<PeriodKind>('week');
	const [key, setKey] = useState(() => periodKeyFor('week', today));
	// Switching Week -> Quarter should land on the quarter *containing* the
	// period you were looking at, not jump to today's.
	const switchKind = (next: PeriodKind) => {
		setKey((current) => periodKeyFor(next, periodRange(current)?.start ?? today));
		setKind(next);
	};

	const [note, setNote] = useState<PeriodNote>(() => plugin.persisted.reviews[key] ?? EMPTY_NOTE);
	useEffect(() => {
		setNote(plugin.persisted.reviews[key] ?? EMPTY_NOTE);
	}, [key, plugin]);

	const completions = useMemo(() => selectPeriodCompletions(log, key), [log, key]);
	const grouped = useMemo(() => groupCompletionsByArea(completions, projects), [completions, projects]);
	const rolled = useMemo(
		() => selectRolledHighlights(key, plugin.persisted.reviews, log),
		[key, log, plugin, note],
	);
	const looseEnds = useMemo(() => selectLooseEnds(tasks, today), [tasks, today]);

	const persist = (next: PeriodNote) => {
		setNote(next);
		plugin.persisted.reviews[key] = { ...next, updatedAt: new Date().toISOString() };
		void plugin.savePersisted();
	};

	const toggleHighlight = (taskId: string) => {
		const on = note.highlights.includes(taskId);
		persist({
			...note,
			highlights: on ? note.highlights.filter((id) => id !== taskId) : [...note.highlights, taskId],
		});
	};

	const writeNote = async () => {
		const path = reviewNotePath(key, plugin.persisted.settings.reviewFolder);
		const body = buildReviewNote({ key, note, completions, grouped, rolled, projects });
		const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
		if (folder !== '' && plugin.app.vault.getAbstractFileByPath(folder) === null) {
			await plugin.app.vault.createFolder(folder).catch(() => undefined);
		}
		const existing = plugin.app.vault.getAbstractFileByPath(path);
		let file: TFile;
		if (existing instanceof TFile) {
			await plugin.app.vault.modify(existing, body);
			file = existing;
		} else {
			file = await plugin.app.vault.create(path, body);
		}
		await plugin.app.workspace.getLeaf(true).openFile(file);
		new Notice(`TaskFlow: wrote ${path}`);
	};

	const isCurrent = key === periodKeyFor(kind, today);

	return (
		<div className="tf2-review">
			<div className="tf2-review-periods">
				{KINDS.map(({ kind: k, label }) => (
					<button
						key={k}
						className={`tf2-review-period ${k === kind ? 'is-active' : ''}`}
						onClick={() => switchKind(k)}
					>
						{label}
					</button>
				))}
			</div>

			<div className="tf2-review-nav">
				<button aria-label="Previous period" onClick={() => setKey(shiftPeriodKey(key, -1))}>
					<ObsidianIcon name="chevron-left" />
				</button>
				<div className="tf2-review-title">
					<h3>{periodLabel(key)}</h3>
					<span className="tf2-review-muted">{periodDateRangeLabel(key)}</span>
				</div>
				<button
					aria-label="Next period"
					disabled={isCurrent}
					onClick={() => setKey(shiftPeriodKey(key, 1))}
				>
					<ObsidianIcon name="chevron-right" />
				</button>
			</div>

			{(looseEnds.overdue > 0 || looseEnds.inbox > 0) && (
				<p className="tf2-review-loose">
					Before you close this out: {looseEnds.overdue > 0 && `${looseEnds.overdue} overdue`}
					{looseEnds.overdue > 0 && looseEnds.inbox > 0 && ' · '}
					{looseEnds.inbox > 0 && `${looseEnds.inbox} in Inbox`}.
				</p>
			)}

			<section className="tf2-review-section">
				<h4>Looking back</h4>
				{completions.length === 0 && rolled.length === 0 ? (
					<p className="tf2-review-muted">Nothing completed in this period.</p>
				) : (
					<>
						<p className="tf2-review-muted">
							{completions.length} completed
							{note.highlights.length > 0 && ` · ${note.highlights.length} starred`}
						</p>
						{grouped.map((area) => (
							<div key={area.area ?? '—'} className="tf2-review-area">
								<div className="tf2-review-area-header">
									<span>{area.area ?? 'Unfiled'}</span>
									<span className="tf2-review-muted">{area.total}</span>
								</div>
								{area.projects.map((project) => (
									<div key={project.path ?? project.name}>
										<div className="tf2-review-project">{project.name}</div>
										{project.entries.map((entry) => {
											const starred = note.highlights.includes(entry.taskId);
											return (
												<div key={entry.taskId + entry.completedAt} className="tf2-review-entry">
													<button
														className={`tf2-review-star ${starred ? 'is-on' : ''}`}
														aria-label={starred ? 'Remove highlight' : 'Mark as a highlight'}
														title="Highlights carry up into the month and quarter"
														onClick={() => toggleHighlight(entry.taskId)}
													>
														<ObsidianIcon name="star" />
													</button>
													<span>{entry.title}</span>
												</div>
											);
										})}
									</div>
								))}
							</div>
						))}
					</>
				)}
			</section>

			{rolled.length > 0 && (
				<section className="tf2-review-section">
					<h4>Carried up</h4>
					<p className="tf2-review-muted">Starred earlier in this {kind}.</p>
					{rolled.map(({ fromKey, entry }) => (
						<div key={entry.taskId} className="tf2-review-entry">
							<span className="tf2-review-from">{periodLabel(fromKey)}</span>
							<span>{entry.title}</span>
						</div>
					))}
				</section>
			)}

			<section className="tf2-review-section">
				<h4>Looking ahead</h4>
				<textarea
					className="tf2-review-text"
					placeholder={`What needs to be true by the end of the next ${kind}?`}
					value={note.focus ?? ''}
					onChange={(e) => persist({ ...note, focus: e.target.value })}
				/>
			</section>

			<section className="tf2-review-section">
				<h4>Notes</h4>
				<textarea
					className="tf2-review-text"
					placeholder="What changed because of this work?"
					value={note.narrative ?? ''}
					onChange={(e) => persist({ ...note, narrative: e.target.value })}
				/>
			</section>

			<div className="tf2-review-footer">
				<button className="mod-cta" onClick={() => void writeNote()}>
					Write review note
				</button>
			</div>
		</div>
	);
}
