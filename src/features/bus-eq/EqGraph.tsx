/**
 * Graph editor for 6 parametric EQ cells. Memoised SVG: a log-frequency
 * grid, the summed response (+ Trim), the selected band's own curve, and one node per cell.
 *
 * Mouse: drag a node = frequency (x) + gain (y), Shift = fine, Esc while dragging = undo the
 * drag; wheel over a node = Q; double-click a node = band on/off. Keyboard (each node is a
 * focusable slider): ←/→ frequency, ↑/↓ gain, PgUp/PgDn Q (Shift = fine), Space/Enter on/off.
 * Hovering shows a readout of the response at the cursor or the hovered band.
 */
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { useElementSize } from "@/components/mixer";
import type { EqCell } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { formatDb } from "@/lib/db";
import { DEFAULT_SAMPLE_RATE, F_MAX, F_MIN, GAIN_SHAPES, cellResponse, logFreqs, response } from "./biquad";
import { eqTypeLabel, eqTypeShape } from "./eqTypes";
import type { EqCellPatch } from "./eqWriter";

export interface EqGraphProps {
  cells: readonly EqCell[];
  /** One call per gesture step; a drag sends `{f, gain}` together so it can go out as one script. */
  onChange: (cell: number, patch: EqCellPatch) => void;
  /** Hz, for the response curve (default 48 kHz). */
  sampleRate?: number;
  /** Channel Trim (dB) added to the curve. */
  trim?: number;
  /** EQ is off: the curve is drawn dimmed (edits still apply). */
  bypassed?: boolean;
  /** Prefix for accessible names ("A1 EQ"). */
  label?: string;
  disabled?: boolean;
  height?: number;
  /** Controlled selection (optional). */
  selected?: number | null;
  onSelect?: (cell: number | null) => void;
  className?: string;
}

const DB_RANGE = 18;
const PAD = { l: 30, r: 10, t: 10, b: 20 };
const NODE_R = 8;
const HIT_R = 16;
const F_GRID = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
const F_LABELS = new Set([100, 1000, 10000]);
const DB_GRID = [-12, -6, 0, 6, 12];
const LOG_MIN = Math.log(F_MIN);
const LOG_SPAN = Math.log(F_MAX) - LOG_MIN;
const FREQS = logFreqs();

const G = { min: -12, max: 12 };
const Q = { min: 1, max: 100 };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const roundF = (f: number) => clamp(f < 1000 ? Math.round(f * 10) / 10 : Math.round(f), F_MIN, F_MAX);
const roundG = (g: number) => clamp(Math.round(g * 10) / 10, G.min, G.max);
const roundQ = (q: number) => clamp(Math.round(q * 100) / 100, Q.min, Q.max);

export const formatHz = (v: number) =>
  v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz` : `${v < 100 ? v.toFixed(1) : Math.round(v)} Hz`;
const fmtDb = (v: number) => `${formatDb(v, -999)} dB`;

/** Does this cell's node sit at its gain (gain shapes and unknown shapes) or on 0 dB? */
const usesGain = (kind: number) => {
  const s = eqTypeShape(kind);
  return s === null || GAIN_SHAPES.has(s);
};

function describe(c: EqCell) {
  return `${formatHz(c.f)}, ${usesGain(c.kind) ? `${fmtDb(c.gain)}, ` : ""}Q ${c.q.toFixed(2)}, ${eqTypeLabel(c.kind)}, ${c.on ? "on" : "off"}`;
}

interface Drag {
  k: number;
  pointer: number;
  x0: number;
  y0: number;
  nx: number;
  ny: number;
  start: EqCell;
  fine: boolean;
}

export const EqGraph = memo(function EqGraph({
  cells,
  onChange,
  sampleRate = DEFAULT_SAMPLE_RATE,
  trim = 0,
  bypassed = false,
  label = "EQ",
  disabled = false,
  height = 220,
  selected: selectedProp,
  onSelect,
  className,
}: EqGraphProps) {
  const [boxRef, { width }] = useElementSize<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [selectedLocal, setSelectedLocal] = useState<number | null>(null);
  const selected = selectedProp !== undefined ? selectedProp : selectedLocal;
  const select = useCallback(
    (k: number | null) => {
      setSelectedLocal(k);
      onSelect?.(k);
    },
    [onSelect],
  );
  const [focused, setFocused] = useState<number | null>(null);
  const [hoverNode, setHoverNode] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const helpId = useId();

  // ---- Geometry ----
  const plotW = Math.max(1, width - PAD.l - PAD.r);
  const plotH = Math.max(1, height - PAD.t - PAD.b);
  const xOf = useCallback((f: number) => PAD.l + ((Math.log(f) - LOG_MIN) / LOG_SPAN) * plotW, [plotW]);
  const fOf = useCallback((x: number) => Math.exp(LOG_MIN + ((x - PAD.l) / plotW) * LOG_SPAN), [plotW]);
  const yOf = useCallback((db: number) => PAD.t + ((DB_RANGE - clamp(db, -DB_RANGE, DB_RANGE)) / (2 * DB_RANGE)) * plotH, [plotH]);
  const dbOf = useCallback((y: number) => DB_RANGE - ((y - PAD.t) / plotH) * 2 * DB_RANGE, [plotH]);

  // ---- Curves (memoised on values, not identity) ----
  const cellsKey = cells.map((c) => `${+c.on}${c.kind}|${c.f}|${c.gain}|${c.q}`).join(";");
  const total = useMemo(() => response(cells, FREQS, { sampleRate, trim }), [cellsKey, sampleRate, trim]);
  const selCell = selected !== null ? cells[selected] : undefined;
  const bandCurve = useMemo(
    () => (selCell ? cellResponse(selCell, FREQS, { sampleRate }) : null),
    [selCell?.on, selCell?.kind, selCell?.f, selCell?.gain, selCell?.q, sampleRate],
  );
  const path = (ys: readonly number[]) =>
    ys.map((db, i) => `${i ? "L" : "M"}${xOf(FREQS[i] ?? F_MIN).toFixed(1)} ${yOf(db).toFixed(1)}`).join("");
  const totalPath = useMemo(() => (width ? path(total) : ""), [total, xOf, yOf, width]);
  const zeroY = yOf(0);
  const fillPath = totalPath ? `${totalPath}L${xOf(F_MAX).toFixed(1)} ${zeroY}L${xOf(F_MIN).toFixed(1)} ${zeroY}Z` : "";
  const bandPath = useMemo(() => (width && bandCurve ? path(bandCurve) : ""), [bandCurve, xOf, yOf, width]);

  const nodePos = useCallback(
    (c: EqCell) => ({
      x: xOf(clamp(c.f, F_MIN, F_MAX)),
      y: yOf(usesGain(c.kind) ? c.gain : 0),
    }),
    [xOf, yOf],
  );

  /** Nearest node within the hit radius of (x, y), preferring the selected one on ties. */
  const hit = useCallback(
    (x: number, y: number): number | null => {
      let best: number | null = null;
      let bestD = HIT_R * HIT_R;
      cells.forEach((c, k) => {
        const p = nodePos(c);
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (d < bestD || (d === bestD && k === selected)) {
          best = k;
          bestD = d;
        }
      });
      return best;
    },
    [cells, nodePos, selected],
  );

  const local = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current?.getBoundingClientRect();
    return r ? { x: e.clientX - r.left, y: e.clientY - r.top } : { x: 0, y: 0 };
  };

  // ---- Edits ----
  const nudgeQ = useCallback(
    (k: number, steps: number, fine: boolean) => {
      const c = cells[k];
      if (!c) return;
      const q = roundQ(c.q * Math.pow(2, steps / (fine ? 24 : 6)));
      if (q !== c.q) onChange(k, { q });
    },
    [cells, onChange],
  );

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (disabled || e.button !== 0) return;
    const p = local(e);
    const k = hit(p.x, p.y);
    if (k === null) return;
    const c = cells[k];
    if (!c) return;
    e.preventDefault();
    const n = nodePos(c);
    drag.current = { k, pointer: e.pointerId, x0: p.x, y0: p.y, nx: n.x, ny: n.y, start: { ...c }, fine: e.shiftKey };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(k);
    select(k);
    (e.currentTarget.querySelector(`[data-node="${k}"]`) as SVGGElement | null)?.focus({ preventScroll: true });
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const p = local(e);
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) {
      setHoverNode(hit(p.x, p.y));
      setHoverX(p.x >= PAD.l && p.x <= PAD.l + plotW ? p.x : null);
      return;
    }
    // Shift switches to fine mid-drag without a jump: re-anchor at the current position.
    if (e.shiftKey !== d.fine) {
      const c = cells[d.k];
      if (c) {
        const n = nodePos(c);
        Object.assign(d, { x0: p.x, y0: p.y, nx: n.x, ny: n.y, fine: e.shiftKey });
      }
    }
    const s = d.fine ? 0.2 : 1;
    const x = clamp(d.nx + (p.x - d.x0) * s, PAD.l, PAD.l + plotW);
    const y = clamp(d.ny + (p.y - d.y0) * s, PAD.t, PAD.t + plotH);
    const c = cells[d.k];
    if (!c) return;
    const patch: EqCellPatch = {};
    const f = roundF(fOf(x));
    if (f !== c.f) patch.f = f;
    if (usesGain(c.kind)) {
      const g = roundG(dbOf(y));
      if (g !== c.gain) patch.gain = g;
    }
    if (patch.f !== undefined || patch.gain !== undefined) onChange(d.k, patch);
    setHoverX(null);
  };

  const endDrag = (e: PointerEvent<SVGSVGElement>) => {
    if (drag.current?.pointer !== e.pointerId) return;
    drag.current = null;
    setDragging(null);
  };

  // Esc during a drag puts the band back where it started.
  useEffect(() => {
    if (dragging === null) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      const d = drag.current;
      if (e.key !== "Escape" || !d) return;
      e.preventDefault();
      e.stopPropagation();
      onChange(d.k, { f: d.start.f, gain: d.start.gain });
      try {
        svgRef.current?.releasePointerCapture(d.pointer);
      } catch {
        /* already released */
      }
      drag.current = null;
      setDragging(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dragging, onChange]);

  // Wheel over a node = Q. Non-passive so the drawer doesn't scroll; elsewhere it scrolls normally.
  const wheelRef = useRef({ hit, nudgeQ, disabled });
  wheelRef.current = { hit, nudgeQ, disabled };
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      const { hit: h, nudgeQ: nq, disabled: off } = wheelRef.current;
      if (off) return;
      const r = svg.getBoundingClientRect();
      const k = h(e.clientX - r.left, e.clientY - r.top);
      if (k === null) return;
      e.preventDefault();
      nq(k, e.deltaY < 0 ? 1 : -1, e.shiftKey);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const onDoubleClick = (e: MouseEvent<SVGSVGElement>) => {
    if (disabled) return;
    const p = local(e);
    const k = hit(p.x, p.y);
    const c = k !== null ? cells[k] : undefined;
    if (k !== null && c) onChange(k, { on: c.on ? 0 : 1 });
  };

  const onNodeKey = (k: number) => (e: KeyboardEvent<SVGGElement>) => {
    const c = cells[k];
    if (!c || disabled) return;
    const fine = e.shiftKey;
    let patch: EqCellPatch | null = null;
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowRight": {
        const dir = e.key === "ArrowRight" ? 1 : -1;
        patch = { f: roundF(c.f * Math.pow(2, dir / (fine ? 48 : 12))) };
        break;
      }
      case "ArrowUp":
      case "ArrowDown":
        if (!usesGain(c.kind)) return;
        patch = { gain: roundG(c.gain + (e.key === "ArrowUp" ? 1 : -1) * (fine ? 0.1 : 0.5)) };
        break;
      case "PageUp":
      case "PageDown":
        e.preventDefault();
        nudgeQ(k, e.key === "PageUp" ? 1 : -1, fine);
        return;
      case " ":
      case "Enter":
        patch = { on: c.on ? 0 : 1 };
        break;
      default:
        return;
    }
    e.preventDefault();
    onChange(k, patch);
  };

  // ---- Readout ----
  const readNode = dragging ?? hoverNode ?? focused;
  const readCell = readNode !== null ? cells[readNode] : undefined;
  let readout: string | null = null;
  if (readCell && readNode !== null) readout = `Band ${readNode + 1} · ${describe(readCell)}`;
  else if (hoverX !== null && width) {
    const f = fOf(hoverX);
    const [db] = response(cells, [f], { sampleRate, trim });
    readout = `${formatHz(f)} · ${fmtDb(db ?? 0)}`;
  }

  const ready = width > 0;
  return (
    <div ref={boxRef} className={cn("relative w-full select-none", className)} style={{ height }}>
      <p id={helpId} className="sr-only">
        Arrow keys move frequency and gain, Page Up and Page Down change Q, Shift for fine steps, Space turns the band on or off.
      </p>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        role="group"
        aria-label={`${label} response graph`}
        className={cn(
          "block rounded-md border border-line bg-bg touch-none",
          disabled ? "opacity-50" : hoverNode !== null || dragging !== null ? "cursor-grab" : undefined,
          dragging !== null && "cursor-grabbing",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onPointerLeave={() => {
          if (!drag.current) {
            setHoverNode(null);
            setHoverX(null);
          }
        }}
        onDoubleClick={onDoubleClick}
      >
        {ready ? (
          <>
            <Grid xOf={xOf} yOf={yOf} plotW={plotW} plotH={plotH} height={height} />
            {fillPath ? <path d={fillPath} fill="var(--fg)" opacity={bypassed ? 0.03 : 0.06} /> : null}
            {bandPath ? <path d={bandPath} fill="none" stroke="var(--text-faint)" strokeWidth={1} strokeDasharray="3 3" /> : null}
            <path
              d={totalPath}
              fill="none"
              stroke={bypassed ? "var(--text-faint)" : "var(--fg)"}
              strokeWidth={1.5}
              strokeLinejoin="round"
            />
            {hoverX !== null && dragging === null ? (
              <line x1={hoverX} x2={hoverX} y1={PAD.t} y2={PAD.t + plotH} stroke="var(--line-strong)" strokeWidth={1} />
            ) : null}
            {cells.map((c, k) => {
              const { x, y } = nodePos(c);
              const sel = k === selected;
              const hot = k === hoverNode || k === dragging;
              return (
                <g
                  key={k}
                  data-node={k}
                  role="slider"
                  tabIndex={disabled ? -1 : 0}
                  aria-label={`${label} band ${k + 1}`}
                  aria-roledescription="EQ band handle"
                  aria-valuemin={F_MIN}
                  aria-valuemax={F_MAX}
                  aria-valuenow={Math.round(c.f)}
                  aria-valuetext={describe(c)}
                  aria-describedby={helpId}
                  aria-disabled={disabled || undefined}
                  style={{ outline: "none" }}
                  onFocus={() => {
                    setFocused(k);
                    select(k);
                  }}
                  onBlur={() => setFocused((f) => (f === k ? null : f))}
                  onKeyDown={onNodeKey(k)}
                >
                  {focused === k ? <circle cx={x} cy={y} r={NODE_R + 3} fill="none" stroke="var(--text)" strokeWidth={2} /> : null}
                  <circle
                    cx={x}
                    cy={y}
                    r={NODE_R}
                    fill={sel ? "var(--fg)" : "var(--panel)"}
                    stroke={c.on ? (hot || sel ? "var(--fg)" : "var(--text-dim)") : "var(--text-faint)"}
                    strokeWidth={1.5}
                    strokeDasharray={c.on ? undefined : "2 2"}
                  />
                  <text
                    x={x}
                    y={y}
                    dy="0.35em"
                    textAnchor="middle"
                    className="tabular pointer-events-none text-11"
                    fill={sel ? "var(--fg-ink)" : c.on ? "var(--text)" : "var(--text-faint)"}
                  >
                    {k + 1}
                  </text>
                </g>
              );
            })}
          </>
        ) : null}
      </svg>
      {readout ? (
        <div className="tabular pointer-events-none absolute top-2 right-3 rounded-sm bg-panel/90 px-1.5 py-0.5 text-11 text-text-dim">
          {readout}
        </div>
      ) : null}
    </div>
  );
});

/** Static grid; only re-renders on resize. */
const Grid = memo(function Grid({
  xOf,
  yOf,
  plotW,
  plotH,
  height,
}: {
  xOf: (f: number) => number;
  yOf: (db: number) => number;
  plotW: number;
  plotH: number;
  height: number;
}) {
  return (
    <g aria-hidden="true">
      {F_GRID.map((f) => (
        <g key={f}>
          <line x1={xOf(f)} x2={xOf(f)} y1={PAD.t} y2={PAD.t + plotH} stroke="var(--line)" strokeWidth={1} />
          {F_LABELS.has(f) ? (
            <text x={xOf(f)} y={height - 6} textAnchor="middle" className="tabular text-11" fill="var(--text-faint)">
              {f >= 1000 ? `${f / 1000}k` : f}
            </text>
          ) : null}
        </g>
      ))}
      {DB_GRID.map((db) => (
        <g key={db}>
          <line
            x1={PAD.l}
            x2={PAD.l + plotW}
            y1={yOf(db)}
            y2={yOf(db)}
            stroke={db === 0 ? "var(--line-strong)" : "var(--line)"}
            strokeWidth={1}
          />
          <text x={PAD.l - 6} y={yOf(db)} dy="0.35em" textAnchor="end" className="tabular text-11" fill="var(--text-faint)">
            {db > 0 ? `+${db}` : db}
          </text>
        </g>
      ))}
    </g>
  );
});
