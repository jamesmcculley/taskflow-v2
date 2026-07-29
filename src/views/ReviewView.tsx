import { useMemo, useState } from 'react';
import { useStore } from 'zustand';
import type TaskFlowPlugin from '../main';
import { buildReviewSteps, selectReviewStepTasks } from '../store/review';
import { diffDaysISO, todayISO } from '../store/selectors';
import { ObsidianIcon } from './components/ObsidianIcon';
import { TaskRows } from './components/TaskList';
import type { TaskFlowView } from './TaskFlowView';

type Phase = { at: 'start' } | { at: 'step'; index: number } | { at: 'done' };

function lastReviewLabel(lastReview: string | undefined, today: string): string {
	if (!lastReview) return 'Never reviewed yet.';
	const day = todayISO(new Date(lastReview));
	const days = diffDaysISO(day, today);
	if (days === 0) return 'Last reviewed today.';
	if (days === 1) return 'Last reviewed yesterday.';
	return `Last reviewed ${days} days ago (${day}).`;
}

export function ReviewView({ plugin, view }: { plugin: TaskFlowPlugin; view: TaskFlowView }) {
	const tasks = useStore(plugin.store, (s) => s.tasks);
	const projects = useStore(plugin.store, (s) => s.projects);
	const [phase, setPhase] = useState<Phase>({ at: 'start' });
	// Step list frozen at the moment the review starts.
	const [steps, setSteps] = useState<ReturnType<typeof buildReviewSteps>>([]);
	const today = todayISO();

	const start = () => {
		const built = buildReviewSteps({ tasks, projects }, today);
		setSteps(built);
		setPhase(built.length === 0 ? { at: 'done' } : { at: 'step', index: 0 });
	};

	const finish = () => {
		plugin.persisted.lastReview = new Date().toISOString();
		void plugin.savePersisted();
		setPhase({ at: 'done' });
	};

	const step = phase.at === 'step' ? steps[phase.index] : undefined;
	const stepTasks = useMemo(
		() => (step ? selectReviewStepTasks(step, { tasks, projects }, today) : []),
		[step, tasks, projects, today],
	);

	if (phase.at === 'start') {
		return (
			<div className="tf2-review">
				<div className="tf2-review-hero">
					<ObsidianIcon name="clipboard-check" className="tf2-list-icon-review" />
					<h3>Weekly Review</h3>
					<p className="tf2-review-muted">{lastReviewLabel(plugin.persisted.lastReview, today)}</p>
					<p className="tf2-review-muted">
						A guided pass through your Inbox, overdue items, every active project, and
						Someday — one group at a time.
					</p>
					<button className="mod-cta" onClick={start}>
						Start review
					</button>
				</div>
			</div>
		);
	}

	if (phase.at === 'done') {
		return (
			<div className="tf2-review">
				<div className="tf2-review-hero">
					<ObsidianIcon name="party-popper" className="tf2-list-icon-review" />
					<h3>Review complete</h3>
					<p className="tf2-review-muted">Everything's been looked at. See you next week.</p>
					<button
						className="mod-cta"
						onClick={() => plugin.store.getState().setRoute({ kind: 'list', list: 'today' })}
					>
						Go to Today
					</button>
				</div>
			</div>
		);
	}

	const index = phase.index;
	const isLast = index === steps.length - 1;

	return (
		<div className="tf2-review">
			<div className="tf2-review-header">
				<div className="tf2-review-progress">
					Step {index + 1} of {steps.length}
				</div>
				<h3>{step?.title}</h3>
				<p className="tf2-review-muted">{step?.blurb}</p>
			</div>
			<div className="tf2-list tf2-review-list">
				<TaskRows
					tasks={stepTasks}
					plugin={plugin}
					view={view}
					emptyMessage="Nothing left here — nice."
				/>
			</div>
			<div className="tf2-review-footer">
				<button disabled={index === 0} onClick={() => setPhase({ at: 'step', index: index - 1 })}>
					Back
				</button>
				{isLast ? (
					<button className="mod-cta" onClick={finish}>
						Finish review
					</button>
				) : (
					<button className="mod-cta" onClick={() => setPhase({ at: 'step', index: index + 1 })}>
						Next
					</button>
				)}
			</div>
		</div>
	);
}
