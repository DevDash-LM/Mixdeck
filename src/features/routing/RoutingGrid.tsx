/**
 * The 8×8 routing matrix (strips × buses). The same `Strip[i].A1…B3` params as the route chips
 * on every strip card.
 *
 * - Click toggles a cell. Press and drag paints: every cell you cross takes the new state of
 *   the first one, and the whole stroke is sent as ONE script on release (Esc cancels).
 * - Keyboard: the grid is one tab stop. Arrow keys move (headers included), Home/End jump to
 *   the row ends (Ctrl = grid corners), Space/Enter toggles a cell or opens a header's menu.
 * - Row/column headers open a menu with bulk actions (confirmed by the parent) and links to the
 *   Strip FX / Bus EQ panels.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ChevronDown } from "lucide-react";
import type { Bus, Strip } from "@/lib/bridge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { BUSES, HW_STRIPS, PHYS_BUSES, STRIPS, isHardwareStrip, isPhysicalBus } from "@/lib/params";
import { busName, busTitle, stripDefaultName, stripName } from "@/features/mixer/labels";

export interface RouteChange {
  strip: number;
  bus: number;
  on: boolean;
}

export type BulkRequest = { kind: "row" | "col"; index: number; on: boolean };

export interface RoutingGridProps {
  strips: Strip[];
  buses: Bus[];
  /** Strip row to highlight and focus (from a strip's "Edit routing"). */
  highlight: { strip: number; nonce: number } | null;
  onHighlightDone: () => void;
  /** Applies a click or a whole paint stroke (only cells that actually change). */
  onCommit: (changes: RouteChange[]) => void;
  onBulk: (req: BulkRequest) => void;
  /** Undefined → the menu item shows "Coming soon". */
  onOpenFx?: (strip: number) => void;
  onOpenEq?: (bus: number) => void;
}

/** r = -1 is the column-header row, c = -1 the row-header column. */
type Pos = { r: number; c: number };
const key = (r: number, c: number) => `${r}:${c}`;
const HIGHLIGHT_MS = 2500;

export function RoutingGrid({
  strips,
  buses,
  highlight,
  onHighlightDone,
  onCommit,
  onBulk,
  onOpenFx,
  onOpenEq,
}: RoutingGridProps) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const [focus, setFocus] = useState<Pos>({ r: 0, c: 0 });
  const [hover, setHover] = useState<Pos | null>(null);
  const [lit, setLit] = useState<number | null>(null);
  const drag = useRef<{ value: boolean; cells: Map<string, boolean> } | null>(null);
  const [paint, setPaint] = useState<ReadonlyMap<string, boolean>>(new Map());

  const route = useCallback((i: number, j: number) => strips[i]?.routes[j] ?? false, [strips]);
  const shown = (i: number, j: number) => paint.get(key(i, j)) ?? route(i, j);

  const setRef = (r: number, c: number) => (el: HTMLButtonElement | null) => {
    if (el) refs.current.set(key(r, c), el);
    else refs.current.delete(key(r, c));
  };

  const moveTo = useCallback((p: Pos) => {
    setFocus(p);
    refs.current.get(key(p.r, p.c))?.focus();
  }, []);

  // ---- "Edit routing" from a strip: focus and briefly highlight its row ----
  useEffect(() => {
    if (!highlight) return;
    setLit(highlight.strip);
    const raf = requestAnimationFrame(() => moveTo({ r: highlight.strip, c: 0 }));
    const t = setTimeout(() => {
      setLit(null);
      onHighlightDone();
    }, HIGHLIGHT_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [highlight, moveTo, onHighlightDone]);

  // ---- Drag painting ----
  const endDrag = useCallback(
    (commit: boolean) => {
      const d = drag.current;
      drag.current = null;
      setPaint(new Map());
      if (!d || !commit) return;
      const changes: RouteChange[] = [];
      for (const [k, on] of d.cells) {
        const [i, j] = k.split(":").map(Number) as [number, number];
        if (route(i, j) !== on) changes.push({ strip: i, bus: j, on });
      }
      if (changes.length) onCommit(changes);
    },
    [onCommit, route],
  );

  useEffect(() => {
    const up = () => drag.current && endDrag(true);
    const cancel = () => drag.current && endDrag(false);
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && drag.current) {
        e.preventDefault();
        endDrag(false);
      }
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", esc, true);
    };
  }, [endDrag]);

  const onCellDown = (e: PointerEvent<HTMLButtonElement>, i: number, j: number) => {
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection while painting
    // Touch/pen capture the pointer implicitly; release it so other cells get pointerenter.
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    moveTo({ r: i, c: j });
    setLit(null);
    const value = !route(i, j);
    drag.current = { value, cells: new Map([[key(i, j), value]]) };
    setPaint(new Map(drag.current.cells));
  };

  const onCellEnter = (e: PointerEvent<HTMLButtonElement>, i: number, j: number) => {
    setHover({ r: i, c: j });
    const d = drag.current;
    if (!d) return;
    if ((e.buttons & 1) === 0) {
      endDrag(true);
      return;
    }
    if (d.cells.get(key(i, j)) === d.value) return;
    d.cells.set(key(i, j), d.value);
    setPaint(new Map(d.cells));
  };

  // ---- Keyboard grid navigation (capture, so header menu triggers don't eat ArrowDown) ----
  const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (!t.dataset.gridPos || e.altKey || e.metaKey) return; // ignore keys from open menus (portals bubble here)
    const { r, c } = focus;
    let next: Pos | null = null;
    switch (e.key) {
      case "ArrowUp":
        next = { r: Math.max(c === -1 ? 0 : -1, r - 1), c };
        break;
      case "ArrowDown":
        next = { r: Math.min(STRIPS - 1, r + 1), c };
        break;
      case "ArrowLeft":
        next = { r, c: Math.max(r === -1 ? 0 : -1, c - 1) };
        break;
      case "ArrowRight":
        next = { r, c: Math.min(BUSES - 1, c + 1) };
        break;
      case "Home":
        next = e.ctrlKey ? { r: 0, c: 0 } : { r, c: r === -1 ? 0 : -1 };
        break;
      case "End":
        next = e.ctrlKey ? { r: STRIPS - 1, c: BUSES - 1 } : { r, c: BUSES - 1 };
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    moveTo(next);
  };

  const tab = (r: number, c: number) => (focus.r === r && focus.c === c ? 0 : -1);
  const gridPos = (r: number, c: number) => ({ "data-grid-pos": key(r, c) });
  const busGap = (j: number) => (j === PHYS_BUSES ? "ml-3" : undefined);
  const rowGap = (i: number) => (i === HW_STRIPS ? "mt-3" : undefined);

  const action = (handler: ((n: number) => void) | undefined, n: number) =>
    handler ? { onSelect: () => handler(n) } : { disabled: true, shortcut: "Coming soon" };

  return (
    <div
      role="grid"
      aria-label="Routing matrix: inputs (rows) to buses (columns)"
      aria-rowcount={STRIPS + 1}
      aria-colcount={BUSES + 1}
      onKeyDownCapture={onKeyDownCapture}
      onPointerLeave={() => setHover(null)}
      className="grid w-max touch-none gap-[3px] select-none"
      style={{ gridTemplateColumns: `minmax(176px, 216px) repeat(${BUSES}, 60px)` }}
    >
      {/* Column headers */}
      <div role="row" className="contents">
        <div role="columnheader" className="flex items-end px-2 pb-1.5 text-11 font-medium tracking-wide text-text-faint uppercase">
          Inputs ↓ · Buses →
        </div>
        {buses.map((b, j) => {
          const on = strips.filter((s) => s.routes[j]).length;
          const sub = isPhysicalBus(j) ? (b.label.trim() || b.device || "No device") : b.label.trim() || "Virtual";
          const active = hover?.c === j || focus.c === j;
          return (
            <div role="columnheader" key={j} className={cn("min-w-0", busGap(j))}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    ref={setRef(-1, j)}
                    {...gridPos(-1, j)}
                    type="button"
                    tabIndex={tab(-1, j)}
                    onFocus={() => setFocus({ r: -1, c: j })}
                    aria-label={`${busTitle(j, b.label)} (${busName(j)}), ${on} of ${STRIPS} inputs routed. Open bus actions`}
                    className={cn(
                      "group flex h-[52px] w-full min-w-0 flex-col items-center justify-end gap-0.5 rounded-md px-1 pb-1.5",
                      "transition-colors duration-120 ease-out hover:bg-panel-2 data-[state=open]:bg-panel-2",
                    )}
                  >
                    <span className={cn("flex items-center gap-0.5 text-13 font-medium", active ? "text-text" : "text-text-dim")}>
                      {busName(j)}
                      <ChevronDown size={11} strokeWidth={1.5} className="text-text-faint opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
                    </span>
                    <span className="w-full truncate text-center text-11 text-text-faint" title={sub}>
                      {sub}
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center">
                  <DropdownMenuLabel>{busTitle(j, b.label) === busName(j) ? `Bus ${busName(j)}` : `${busName(j)} · ${b.label}`}</DropdownMenuLabel>
                  <DropdownMenuItem disabled={on === STRIPS} onSelect={() => onBulk({ kind: "col", index: j, on: true })}>
                    Route all inputs here
                  </DropdownMenuItem>
                  <DropdownMenuItem destructive disabled={on === 0} onSelect={() => onBulk({ kind: "col", index: j, on: false })}>
                    Clear column
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem {...action(onOpenEq, j)}>EQ editor…</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        })}
      </div>

      {/* Rows */}
      {strips.map((s, i) => {
        const name = stripName(i, s.label);
        const full = s.label.trim() ? `${s.label.trim()} (${stripDefaultName(i)})` : stripDefaultName(i);
        const sub = isHardwareStrip(i) ? (s.device ?? "No device") : "Virtual input";
        const on = s.routes.filter(Boolean).length;
        const active = hover?.r === i || focus.r === i;
        const isLit = lit === i;
        return (
          <div role="row" key={i} className="contents">
            <div role="rowheader" className={cn("min-w-0", rowGap(i))}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    ref={setRef(i, -1)}
                    {...gridPos(i, -1)}
                    type="button"
                    tabIndex={tab(i, -1)}
                    onFocus={() => setFocus({ r: i, c: -1 })}
                    aria-label={`${full}, routed to ${on} of ${BUSES} buses. Open input actions`}
                    className={cn(
                      "group relative flex h-11 w-full min-w-0 items-center gap-2 rounded-md pr-1.5 pl-3 text-left",
                      "transition-colors duration-120 ease-out hover:bg-panel-2 data-[state=open]:bg-panel-2",
                      isLit && "bg-panel-2",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-fg transition-opacity duration-200 ease-out",
                        isLit ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={cn("truncate text-13 font-medium", active || isLit ? "text-text" : "text-text-dim")} title={full}>
                        {name}
                      </span>
                      <span className="truncate text-11 text-text-faint" title={sub}>
                        {sub}
                      </span>
                    </span>
                    <ChevronDown size={12} strokeWidth={1.5} className="shrink-0 text-text-faint opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>{full}</DropdownMenuLabel>
                  <DropdownMenuItem disabled={on === BUSES} onSelect={() => onBulk({ kind: "row", index: i, on: true })}>
                    Route to all buses
                  </DropdownMenuItem>
                  <DropdownMenuItem destructive disabled={on === 0} onSelect={() => onBulk({ kind: "row", index: i, on: false })}>
                    Clear row
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem {...action(onOpenFx, i)}>Effects…</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {buses.map((_, j) => {
              const value = shown(i, j);
              const painted = paint.has(key(i, j));
              const cross = hover !== null && (hover.r === i || hover.c === j);
              return (
                <div role="gridcell" key={j} className={cn(busGap(j), rowGap(i))}>
                  <button
                    ref={setRef(i, j)}
                    {...gridPos(i, j)}
                    type="button"
                    tabIndex={tab(i, j)}
                    aria-pressed={value}
                    aria-label={`${full} to ${busName(j)}`}
                    onFocus={() => setFocus({ r: i, c: j })}
                    onPointerDown={(e) => onCellDown(e, i, j)}
                    onPointerEnter={(e) => onCellEnter(e, i, j)}
                    onClick={(e) => {
                      // Mouse/touch toggles happen on pointerdown; this is Space/Enter.
                      if (e.detail === 0) onCommit([{ strip: i, bus: j, on: !route(i, j) }]);
                    }}
                    className={cn(
                      "flex h-11 w-full items-center justify-center rounded-md border text-11 font-medium",
                      "transition-colors duration-120 ease-out",
                      value
                        ? "border-fg bg-fg text-fg-ink"
                        : cn(
                            "border-line bg-panel-2 text-text-faint hover:border-line-strong",
                            (cross || isLit) && "border-line-strong",
                          ),
                      painted && "opacity-80",
                    )}
                  >
                    {value ? busName(j) : <span aria-hidden className="size-1 rounded-full bg-line-strong" />}
                  </button>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
