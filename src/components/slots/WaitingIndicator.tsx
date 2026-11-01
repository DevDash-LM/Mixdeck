/**
 * Slot: "Waiting for Voicemeeter…" while auto-retrying.
 * Props: { label?: string }.
 * Default: three 4px bars pulsing in sequence (opacity only), `text-dim`. The only looping
 * animation allowed in the app; static under reduced motion.
 */
export interface WaitingIndicatorProps {
  label?: string;
}

export default function WaitingIndicator({ label }: WaitingIndicatorProps) {
  return (
    <div role="status" aria-live="polite" className="inline-flex items-center gap-2.5 text-13 text-text-dim">
      <span aria-hidden className="inline-flex h-3 items-end gap-[3px]">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="block h-3 w-1 rounded-[1px] bg-text-dim"
            style={{ animation: `waiting-bar 1.2s ease-in-out ${i * 0.16}s infinite` }}
          />
        ))}
      </span>
      {label ? <span>{label}</span> : <span className="sr-only">Waiting</span>}
    </div>
  );
}
