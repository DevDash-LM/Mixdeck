/**
 * Drag handle between two resizable Mixer panels (WAI-ARIA window splitter).
 *  - `axis="x"`: a vertical rule between side-by-side panels; drag left/right.
 *  - `axis="y"`: a horizontal rule between stacked zones; drag up/down.
 * Pointer drags report the offset from where the drag started; arrow keys nudge by 16px
 * (Shift: 64px); double-click resets. The 1px rule brightens on hover, focus and while dragging.
 */
import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/cn";

export interface SplitterProps {
  axis: "x" | "y";
  label: string;
  /** Called once when a drag (or key nudge) starts, before the first `onDrag`. */
  onStart: () => void;
  /** Offset in px from the drag start (positive = right / down). */
  onDrag: (delta: number) => void;
  onEnd: () => void;
  onReset: () => void;
  /** Current size of the panel before the splitter, for `aria-valuenow`. */
  value?: number;
  /** `line-strong` rule (before Master) instead of `line`. */
  strong?: boolean;
  /** No resting rule (it sits on an existing border); the line only shows on hover, focus, drag. */
  ghost?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function Splitter({ axis, label, onStart, onDrag, onEnd, onReset, value, strong, ghost, className, style }: SplitterProps) {
  const origin = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const x = axis === "x";

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    origin.current = x ? e.clientX : e.clientY;
    setDragging(true);
    onStart();
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (origin.current === null) return;
    onDrag((x ? e.clientX : e.clientY) - origin.current);
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (origin.current === null) return;
    origin.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    onEnd();
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16;
    const dir =
      (x && e.key === "ArrowLeft") || (!x && e.key === "ArrowUp") ? -1 : (x && e.key === "ArrowRight") || (!x && e.key === "ArrowDown") ? 1 : 0;
    if (dir !== 0) {
      e.preventDefault();
      onStart();
      onDrag(dir * step);
      onEnd();
    } else if (e.key === "Enter" || e.key === "Home") {
      e.preventDefault();
      onReset();
    }
  };

  return (
    <div
      role="separator"
      aria-orientation={x ? "vertical" : "horizontal"}
      aria-label={`${label}. Drag or use the arrow keys to resize; double-click or Enter to reset`}
      aria-valuenow={value !== undefined ? Math.round(value) : undefined}
      tabIndex={0}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
      onDoubleClick={onReset}
      onKeyDown={key}
      title={x ? "Drag to resize · double-click to reset" : "Drag to resize the fader · double-click to reset"}
      className={cn(
        "group flex shrink-0 touch-none justify-center select-none focus-visible:outline-none",
        x ? "cursor-col-resize self-stretch" : "cursor-row-resize flex-col",
        className,
      )}
      style={style}
    >
      <div
        className={cn(
          "transition-colors duration-150 ease-out",
          x ? "h-full w-px" : "h-px w-full",
          dragging
            ? "bg-text-dim"
            : cn(ghost ? "bg-transparent" : strong ? "bg-line-strong" : "bg-line", "group-hover:bg-text-faint group-focus-visible:bg-text-dim"),
        )}
      />
    </div>
  );
}
