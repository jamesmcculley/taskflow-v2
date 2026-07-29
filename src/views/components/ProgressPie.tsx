/** Circular progress indicator for a project. */
export function ProgressPie({ fraction }: { fraction: number }) {
	const pct = Math.max(0, Math.min(1, fraction)) * 100;
	return (
		<span
			className="tf2-pie"
			style={{
				background: `conic-gradient(currentColor ${pct}%, transparent ${pct}%)`,
			}}
		/>
	);
}
