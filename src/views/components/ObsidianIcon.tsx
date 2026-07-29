import { setIcon } from 'obsidian';
import { useEffect, useRef } from 'react';

/** Renders a lucide icon through Obsidian's setIcon. */
export function ObsidianIcon({ name, className }: { name: string; className?: string }) {
	const ref = useRef<HTMLSpanElement>(null);
	useEffect(() => {
		if (ref.current) setIcon(ref.current, name);
	}, [name]);
	return <span ref={ref} className={`tf2-icon ${className ?? ''}`} />;
}
