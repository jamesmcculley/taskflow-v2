import { TFile } from 'obsidian';
import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import type TaskFlowPlugin from '../../main';
import { SOMEDAY_TAG, TONIGHT_TAG } from '../../org/tags';
import { priorityFromRank } from '../../org/keywords';
import { diffDaysISO, todayISO } from '../../store/selectors';
import type { Task } from '../../types';
import { DateSuggestModal } from '../DateSuggestModal';
import { showTaskMenu } from '../taskMenu';
import { HOVER_SOURCE_TASKFLOW } from '../TaskFlowView';
import type { TaskFlowView } from '../TaskFlowView';

function formatChipDate(iso: string): string {
	const today = todayISO();
	if (iso === today) return 'Today';
	const [y, m, d] = iso.split('-').map(Number);
	if (y === undefined || m === undefined || d === undefined) return iso;
	const date = new Date(y, m - 1, d);
	const tomorrow = new Date();
	tomorrow.setDate(tomorrow.getDate() + 1);
	if (iso === todayISO(tomorrow)) return 'Tomorrow';
	return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function deadlineBadge(due: string, today: string): { text: string; urgent: boolean } | null {
	const days = diffDaysISO(today, due);
	if (days < 0) return { text: `${-days}d overdue`, urgent: true };
	if (days === 0) return { text: 'due today', urgent: true };
	if (days <= 14) return { text: `${days}d left`, urgent: days <= 2 };
	return null;
}

/** Tags the UI renders as their own affordance rather than as a plain chip. */
const IMPLICIT_TAGS = new Set([SOMEDAY_TAG, TONIGHT_TAG]);

export async function openTaskSource(plugin: TaskFlowPlugin, task: Task): Promise<void> {
	const file = plugin.app.vault.getAbstractFileByPath(task.file);
	if (!(file instanceof TFile)) return;
	const leaf = plugin.app.workspace.getLeaf(false);
	await leaf.openFile(file, { eState: { line: task.line } });
}

export function TaskItem({
	task,
	plugin,
	view,
	hideSource,
	lingering,
}: {
	task: Task;
	plugin: TaskFlowPlugin;
	view: TaskFlowView;
	/** Suppress the source-note chip — used inside that note's own project/area view, where it's redundant. */
	hideSource?: boolean;
	lingering?: boolean;
}) {
	const selectedId = useStore(plugin.store, (s) => s.selectedId);
	const select = useStore(plugin.store, (s) => s.select);
	const selected = selectedId === task.id;
	const rowRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (selected) rowRef.current?.scrollIntoView({ block: 'nearest' });
	}, [selected]);

	// The note a task lives in, shown as a tag-like chip regardless of whether
	// that note is a project — Inbox/daily-note/plain-note tasks otherwise have
	// no visible indicator of where they came from.
	const sourceName = task.file.split('/').pop()?.replace(/\.md$/, '');
	const today = todayISO();
	const badge = task.due && task.status === 'todo' ? deadlineBadge(task.due, today) : null;
	const cookie = priorityFromRank(task.priority);

	return (
		<div
			ref={rowRef}
			className={`tf2-task ${selected ? 'is-selected' : ''} ${lingering ? 'is-lingering' : ''}`}
			onClick={() => select(task.id)}
			onDoubleClick={() => void openTaskSource(plugin, task)}
			onContextMenu={(e) => {
				e.preventDefault();
				select(task.id);
				showTaskMenu(plugin, task, e.nativeEvent);
			}}
			onMouseOver={(e) => {
				plugin.app.workspace.trigger('hover-link', {
					event: e.nativeEvent,
					source: HOVER_SOURCE_TASKFLOW,
					hoverParent: view,
					targetEl: e.currentTarget,
					linktext: task.file,
					sourcePath: task.file,
				});
			}}
		>
			<input
				type="checkbox"
				className="tf2-task-checkbox"
				checked={task.status === 'done'}
				data-status={task.status}
				onClick={(e) => e.stopPropagation()}
				onChange={() => {
					if (task.status === 'done') void plugin.actions.uncompleteTask(task.id);
					else void plugin.actions.completeTask(task.id);
				}}
			/>
			<div className="tf2-task-body">
				<div className={`tf2-task-title ${task.status !== 'todo' ? 'is-closed' : ''}`}>
					{/* The keyword is the org-native state, so it leads the line and
					    doubles as the control for changing it. */}
					<span
						className={`tf2-keyword is-${task.keyword.toLowerCase()}`}
						title="Cycle TODO keyword"
						onClick={(e) => {
							e.stopPropagation();
							void plugin.actions.cycleKeyword(task.id);
						}}
					>
						{task.keyword}
					</span>
					{task.title}
				</div>
				{selected && task.checklist && task.checklist.length > 0 && (
					<div className="tf2-checklist">
						{task.checklist.map((item) => (
							<label
								key={item.id}
								className="tf2-checklist-item"
								onClick={(e) => e.stopPropagation()}
							>
								<input
									type="checkbox"
									className="tf2-task-checkbox tf2-checklist-checkbox"
									checked={item.done}
									onChange={() => void plugin.actions.toggleChecklistItem(task.id, item.id)}
								/>
								<span className={item.done ? 'is-closed' : ''}>{item.title}</span>
							</label>
						))}
					</div>
				)}
				<div className="tf2-task-meta">
					{cookie && (
						<span className={`tf2-chip tf2-chip-priority is-p${task.priority}`}>
							[#{cookie}]
						</span>
					)}
					{task.checklist && task.checklist.length > 0 && (
						<span className="tf2-chip tf2-chip-checklist">
							☑ {task.checklist.filter((c) => c.done).length}/{task.checklist.length}
						</span>
					)}
					{task.evening && <span className="tf2-chip tf2-chip-evening">🌙 tonight</span>}
					{sourceName && !hideSource && (
						<span className="tf2-chip tf2-chip-source" title={task.file}>
							#{sourceName}
						</span>
					)}
					{task.heading && <span className="tf2-chip tf2-chip-heading">{task.heading}</span>}
					{task.scheduled && (
						<span
							className={`tf2-chip tf2-chip-date tf2-chip-clickable ${task.scheduled < today ? 'is-overdue' : ''}`}
							title="Reschedule…"
							onClick={(e) => {
								e.stopPropagation();
								new DateSuggestModal(plugin.app, 'Schedule', true, (date) => {
									void plugin.actions.scheduleTask(task.id, date);
								}).open();
							}}
						>
							SCHEDULED {formatChipDate(task.scheduled)}
							{task.scheduledTime ? ` ${task.scheduledTime}` : ''}
						</span>
					)}
					{task.due && (
						<span
							className={`tf2-chip tf2-chip-due tf2-chip-clickable ${task.due < today ? 'is-overdue' : ''}`}
							title="Change deadline…"
							onClick={(e) => {
								e.stopPropagation();
								new DateSuggestModal(plugin.app, 'Deadline', true, (date) => {
									void plugin.actions.setDue(task.id, date);
								}).open();
							}}
						>
							DEADLINE {formatChipDate(task.due)}
						</span>
					)}
					{badge && (
						<span className={`tf2-chip tf2-chip-deadline ${badge.urgent ? 'is-overdue' : ''}`}>
							{badge.text}
						</span>
					)}
					{task.repeater && <span className="tf2-chip tf2-chip-recur">{task.repeater}</span>}
					{task.tags
						.filter((tag) => !IMPLICIT_TAGS.has(tag))
						.map((tag) => (
							<span key={tag} className="tf2-chip tf2-chip-tag">
								:{tag}:
							</span>
						))}
				</div>
			</div>
		</div>
	);
}

/** The agenda's row renderer — the same item, named for how the agenda reads. */
export const TaskRow = TaskItem;
