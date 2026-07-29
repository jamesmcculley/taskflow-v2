import { useMemo } from 'react';
import { useStore } from 'zustand';
import type TaskFlowPlugin from '../main';
import { agendaDayLabel, agendaPrefix, buildAgenda } from '../store/agenda';
import type { AgendaDay, AgendaEntry } from '../store/agenda';
import { addDaysISO, todayISO } from '../store/selectors';
import { ObsidianIcon } from './components/ObsidianIcon';
import { TaskRow } from './components/TaskItem';
import type { TaskFlowView } from './TaskFlowView';

interface AgendaProps {
	plugin: TaskFlowPlugin;
	view: TaskFlowView;
}

const SPANS: { label: string; days: number }[] = [
	{ label: 'D', days: 1 },
	{ label: '3D', days: 3 },
	{ label: 'W', days: 7 },
	{ label: 'F', days: 14 },
];

/**
 * The org-agenda: a window of days, each listing the tasks whose SCHEDULED or
 * DEADLINE stamp lands them there. Unlike the fixed lists, a task can appear on
 * several days (and twice on one day, once per stamp) — that repetition is the
 * point, since it's what makes a deadline visible before it arrives.
 */
export function AgendaView({ plugin, view }: AgendaProps) {
	const tasks = useStore(plugin.store, (s) => s.tasks);
	const start = useStore(plugin.store, (s) => s.agendaStart);
	const span = useStore(plugin.store, (s) => s.agendaSpan);
	const { deadlineWarningDays, showScheduledPast } = plugin.persisted.settings;
	const today = todayISO();
	const from = start ?? today;

	const days = useMemo(
		() => buildAgenda(tasks, { start: from, span, deadlineWarningDays, showScheduledPast }),
		[tasks, from, span, deadlineWarningDays, showScheduledPast],
	);

	const empty = days.every((d) => d.timed.length === 0 && d.untimed.length === 0);

	return (
		<div className="tf2-agenda">
			<div className="tf2-agenda-toolbar">
				<button
					className="tf2-agenda-nav"
					aria-label="Earlier"
					onClick={() => plugin.store.getState().setAgendaStart(addDaysISO(from, -span))}
				>
					<ObsidianIcon name="chevron-left" />
				</button>
				<button
					className="tf2-agenda-today"
					onClick={() => plugin.store.getState().setAgendaStart(null)}
					disabled={start === null}
				>
					Today
				</button>
				<button
					className="tf2-agenda-nav"
					aria-label="Later"
					onClick={() => plugin.store.getState().setAgendaStart(addDaysISO(from, span))}
				>
					<ObsidianIcon name="chevron-right" />
				</button>
				<div className="tf2-agenda-spans">
					{SPANS.map((s) => (
						<button
							key={s.days}
							className={`tf2-agenda-span${s.days === span ? ' is-active' : ''}`}
							title={`${s.days} day${s.days === 1 ? '' : 's'}`}
							onClick={() => plugin.store.getState().setAgendaSpan(s.days)}
						>
							{s.label}
						</button>
					))}
				</div>
			</div>

			{empty ? (
				<div className="tf2-empty">Nothing scheduled in this window.</div>
			) : (
				days.map((day) => <AgendaDayBlock key={day.date} day={day} today={today} plugin={plugin} view={view} />)
			)}
		</div>
	);
}

function AgendaDayBlock({
	day,
	today,
	plugin,
	view,
}: {
	day: AgendaDay;
	today: string;
	plugin: TaskFlowPlugin;
	view: TaskFlowView;
}) {
	const total = day.timed.length + day.untimed.length;
	return (
		<div className={`tf2-agenda-day${day.date === today ? ' is-today' : ''}`}>
			<div className="tf2-group-header tf2-agenda-header">
				{agendaDayLabel(day.date, today)}
				{total > 0 && <span className="tf2-group-date">{total}</span>}
			</div>
			{day.timed.map((entry) => (
				<AgendaLine key={`t-${entry.task.id}`} entry={entry} plugin={plugin} view={view} />
			))}
			{day.untimed.map((entry) => (
				<AgendaLine key={`${entry.reason}-${entry.task.id}`} entry={entry} plugin={plugin} view={view} />
			))}
			{total === 0 && <div className="tf2-agenda-empty-day">—</div>}
		</div>
	);
}

/**
 * One agenda line. The org prefix ("Sched. 3x", "In 4 d.") is rendered as a
 * fixed-width gutter so the titles line up down the column the way they do in
 * org's own buffer.
 */
function AgendaLine({
	entry,
	plugin,
	view,
}: {
	entry: AgendaEntry;
	plugin: TaskFlowPlugin;
	view: TaskFlowView;
}) {
	const prefix = agendaPrefix(entry);
	const time = entry.task.scheduledTime;
	const overdue = entry.reason === 'past-deadline' || entry.reason === 'past-scheduled';
	return (
		<div className={`tf2-agenda-line${overdue ? ' is-overdue' : ''}`}>
			<span className="tf2-agenda-gutter">
				{time !== undefined
					? `${time}${entry.task.scheduledEndTime ? `–${entry.task.scheduledEndTime}` : ''}`
					: (prefix ?? '')}
			</span>
			<TaskRow task={entry.task} plugin={plugin} view={view} />
		</div>
	);
}
