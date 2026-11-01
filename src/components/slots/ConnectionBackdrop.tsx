/**
 * Slot: backdrop behind the Connection screen.
 * Props: { state: 'not-installed' | 'not-running' | 'wrong-edition' | 'connecting' }.
 * Default: static 24px dot grid at 4 % opacity, fading radially to `bg` at the edges.
 * Fills its positioned parent; never intercepts pointer events.
 */
export interface ConnectionBackdropProps {
  state: "not-installed" | "not-running" | "wrong-edition" | "connecting";
}

export default function ConnectionBackdrop({ state }: ConnectionBackdropProps) {
  return (
    <div
      aria-hidden
      data-state={state}
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage: "radial-gradient(circle at center, rgb(237 237 237 / 0.04) 1px, transparent 1.5px)",
        backgroundSize: "24px 24px",
        backgroundPosition: "center",
        maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
        WebkitMaskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
      }}
    />
  );
}
