/**
 * One app in a virtual strip's Apps zone, ~44px:
 *   line 1: icon 20 (live dot on its corner) · name (truncates, tooltip) · Mute chip 22
 *   line 2: horizontal volume slider 0–100 % (Windows session volume) + 2px peak bar
 * The live dot and peak bar are drawn in the shared meter rAF loop from `appLevels`, never through
 * React state. Inactive sessions sit at 40 % until hovered or focused.
 */
import { memo, useEffect, useRef, type RefObject } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { addMeterDraw, ToggleChip, useContinuous } from "@/components/mixer";
import { Tooltip } from "@/components/ui";
import type { AppSession } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { appLevels, useSessionsStore } from "@/stores/sessionsStore";
import { AppIcon } from "./AppIcon";
import { LIVE_THRESHOLD } from "./useApps";

/** Peak bar range: −60 dB … 0 dB. */
const FLOOR_DB = -60;
/** Fall rate of the peak bar, in bar fractions per frame (~1 s from full to empty at 60 fps). */
const FALL = 1 / 60;

function barFraction(linear: number): number {
  if (linear <= 0) return 0;
  const db = 20 * Math.log10(linear);
  return Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB));
}

/** Drives the live dot + peak bar of one app from the shared rAF loop. */
function useAppPeak(key: string) {
  const dot = useRef<HTMLSpanElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let shown = -1;
    let live: boolean | null = null;
    return addMeterDraw(() => {
      const lin = appLevels.get(key);
      const target = barFraction(lin);
      const next = target >= shown ? target : Math.max(target, shown - FALL);
      if (Math.abs(next - shown) > 0.002 && bar.current) {
        bar.current.style.transform = `scaleX(${next})`;
        shown = next;
      }
      const isLive = lin > LIVE_THRESHOLD;
      if (isLive !== live && dot.current) {
        dot.current.style.opacity = isLive ? "1" : "0";
        live = isLive;
      }
    });
  }, [key]);
  return { dot, bar };
}

function VolumeSlider({ app, barRef }: { app: AppSession; barRef: RefObject<HTMLSpanElement | null> }) {
  const pct = Math.round(app.volume * 100);
  const rail = useRef<HTMLDivElement>(null);
  const c = useContinuous({
    value: pct,
    min: 0,
    max: 100,
    defaultValue: 100,
    step: 1,
    fineStep: 1,
    pageStep: 10,
    axis: "x",
    travel: () => rail.current?.clientWidth ?? 80,
    onChange: (v) => useSessionsStore.getState().setAppVolume(app.key, v / 100),
  });

  return (
    <div className="flex min-w-0 items-center gap-1">
      <div
        ref={(el) => {
          rail.current = el;
          c.wheelRef(el);
        }}
        role="slider"
        tabIndex={0}
        aria-label={`${app.name} volume`}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${pct}%${app.muted ? ", muted" : ""}`}
        title={`${pct}%`}
        {...c.bind}
        className="relative h-3.5 min-w-0 flex-1 cursor-ew-resize touch-none rounded-sm outline-offset-0"
      >
        {/* rail */}
        <span aria-hidden className="absolute inset-x-[5px] top-[4px] h-[3px] rounded-full bg-line" />
        <span
          aria-hidden
          className={cn("absolute top-[4px] left-[5px] h-[3px] rounded-full", app.muted ? "bg-text-faint" : "bg-text-dim")}
          style={{ width: `calc((100% - 10px) * ${pct / 100})` }}
        />
        {/* thumb */}
        <span
          aria-hidden
          className={cn(
            "absolute top-[1px] size-[9px] -translate-x-1/2 rounded-full",
            c.dragging ? "bg-text" : "bg-fg",
          )}
          style={{ left: `calc(5px + (100% - 10px) * ${pct / 100})` }}
        />
        {/* 2px live peak bar under the rail */}
        <span aria-hidden className="absolute inset-x-[5px] bottom-0 h-[2px] overflow-hidden rounded-full bg-panel-2">
          <span
            ref={barRef}
            className="block h-full w-full origin-left bg-meter-lo"
            style={{ transform: "scaleX(0)", opacity: app.muted ? 0.4 : 1 }}
          />
        </span>
      </div>
      {/* Numeric value only when the strip is wide enough (container query on the Apps zone). */}
      <span aria-hidden className="tabular hidden w-6 shrink-0 text-right text-11 text-text-faint @min-[118px]:inline">
        {pct}
      </span>
    </div>
  );
}

export interface AppRowProps {
  app: AppSession;
}

function AppRowImpl({ app }: AppRowProps) {
  const { dot, bar } = useAppPeak(app.key);
  const setMute = (muted: boolean) => void useSessionsStore.getState().setAppMute(app.key, muted);

  return (
    <li
      aria-label={`${app.name}${app.active ? "" : ", inactive"}${app.muted ? ", muted" : ""}`}
      className={cn(
        "flex h-[44px] shrink-0 flex-col justify-center gap-1 rounded-md px-1 transition-opacity duration-150 ease-out",
        "hover:bg-panel-2/60",
        !app.active && "opacity-40 focus-within:opacity-100 hover:opacity-100",
      )}
    >
      <div className="flex h-[22px] min-w-0 items-center gap-1.5">
        <span className="relative shrink-0">
          <AppIcon app={app} size={20} />
          <span
            ref={dot}
            aria-hidden
            title="Playing"
            className="absolute -right-[2px] -bottom-[2px] size-[7px] rounded-full bg-meter-lo ring-2 ring-panel"
            style={{ opacity: 0 }}
          />
        </span>
        <Tooltip content={app.name}>
          <span className="min-w-0 flex-1 truncate text-12 leading-4 text-text">{app.name}</span>
        </Tooltip>
        <ToggleChip
          size="sm"
          tone="mute"
          pressed={app.muted}
          onPressedChange={setMute}
          label={app.muted ? `Unmute ${app.name}` : `Mute ${app.name}`}
          tooltip={app.muted ? "Unmute" : "Mute"}
          className="w-[22px] shrink-0 px-0"
        >
          {app.muted ? <VolumeX size={13} strokeWidth={1.75} aria-hidden /> : <Volume2 size={13} strokeWidth={1.5} aria-hidden />}
        </ToggleChip>
      </div>
      <VolumeSlider app={app} barRef={bar} />
    </li>
  );
}

const sameApp = (a: AppSession, b: AppSession) =>
  a === b ||
  (a.key === b.key &&
    a.name === b.name &&
    a.icon === b.icon &&
    a.active === b.active &&
    a.volume === b.volume &&
    a.muted === b.muted);

export const AppRow = memo(AppRowImpl, (a, b) => sameApp(a.app, b.app));
