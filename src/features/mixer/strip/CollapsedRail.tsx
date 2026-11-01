/**
 * Collapsed input strip: a 36px rail with the vertical name, a mute/solo
 * dot and a thin meter. Clicking it (or Enter/Space) expands the strip again.
 */
import { memo, useMemo } from "react";
import { ChevronsLeftRight } from "lucide-react";
import { Meter } from "@/components/mixer";
import { Tooltip } from "@/components/ui";
import type { Strip } from "@/lib/bridge";
import { stripDefaultName, stripName } from "../labels";
import { RAIL_WIDTH } from "./layout";
import { stripBars } from "./InputStrip";

export interface CollapsedRailProps {
  strip: Strip;
  onExpand: (i: number) => void;
}

function CollapsedRailImpl({ strip: s, onExpand }: CollapsedRailProps) {
  const i = s.index;
  const name = stripName(i, s.label);
  const hw = s.kind === "hardware";
  const bars = useMemo(() => stripBars(i, hw), [i, hw]);
  const state = [s.mute && "muted", s.solo && "soloed"].filter(Boolean).join(", ");
  return (
    <section
      data-strip={i}
      data-collapsed
      aria-label={`${s.label.trim() || stripDefaultName(i)} (collapsed)`}
      className="flex h-full shrink-0 rounded-lg border border-line bg-panel transition-colors duration-150 ease-out hover:border-line-strong"
      style={{ width: RAIL_WIDTH }}
    >
      <Tooltip content={`Expand ${name}`}>
        <button
          type="button"
          aria-expanded={false}
          aria-label={`${name}${state ? `, ${state}` : ""}. Expand strip`}
          onClick={() => onExpand(i)}
          className="flex h-full w-full flex-col items-center gap-2 rounded-lg py-2 text-text-dim hover:text-text focus-visible:outline-offset-[-2px]"
        >
          <ChevronsLeftRight aria-hidden size={14} strokeWidth={1.5} className="shrink-0 text-text-faint" />
          <span className="flex h-2 shrink-0 items-center gap-1" aria-hidden>
            {s.mute ? <span className="size-1.5 rounded-full bg-mute" /> : null}
            {s.solo ? <span className="size-1.5 rounded-full bg-solo" /> : null}
          </span>
          <span
            className="max-h-[45%] min-h-0 shrink truncate text-13 font-medium text-text [writing-mode:vertical-rl] rotate-180"
            title={name}
          >
            {name}
          </span>
          <div className="flex min-h-0 w-full flex-1 justify-center">
            <Meter kind="in" bars={bars} barWidth={2} barGap={1} dimmed={s.mute} label={`${name} level`} />
          </div>
        </button>
      </Tooltip>
    </section>
  );
}

export const CollapsedRail = memo(
  CollapsedRailImpl,
  (a, b) =>
    a.onExpand === b.onExpand &&
    a.strip.index === b.strip.index &&
    a.strip.label === b.strip.label &&
    a.strip.mute === b.strip.mute &&
    a.strip.solo === b.strip.solo &&
    a.strip.kind === b.strip.kind,
);
