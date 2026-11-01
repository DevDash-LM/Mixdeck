/**
 * Bus row button block: 2×2, Mute · Mono / EQ · Sel, each ≥ 44×26.
 * Mono cycles off → mono → stereo reverse ("Rev"). EQ right-click opens the Bus EQ editor.
 * Buses have no Solo in the API (decision D1).
 */
import { ToggleChip } from "@/components/mixer";
import { cn } from "@/lib/cn";
import { MONO_LABEL } from "../labels";
import { BUS_BUTTON } from "./layout";

export interface BusButtonsProps {
  /** Bus display name for accessible labels ("A1", or the custom label). */
  title: string;
  /** 26px buttons (compact rows) instead of 28px. */
  compact: boolean;
  mute: boolean;
  /** 0 off, 1 mono, 2 stereo reverse. */
  mono: 0 | 1 | 2;
  eqOn: boolean;
  sel: boolean;
  onMute: (on: boolean) => void;
  /** Called with the next mono state. */
  onMono: (next: 0 | 1 | 2) => void;
  onEq: (on: boolean) => void;
  onSel: (on: boolean) => void;
  /** Open the Bus EQ editor (right-click on EQ). Absent = plain toggle. */
  onOpenEq?: () => void;
}

export function BusButtons({ title, compact, mute, mono, eqOn, sel, onMute, onMono, onEq, onSel, onOpenEq }: BusButtonsProps) {
  const chip = cn("px-0", compact ? "h-[26px]" : "h-[var(--ctl-md)]");
  return (
    <div
      role="group"
      aria-label={`${title} buttons`}
      className="grid self-center"
      style={{ gridTemplateColumns: `repeat(2, ${BUS_BUTTON.w}px)`, gap: BUS_BUTTON.gap }}
    >
      <ToggleChip size="md" tone="mute" className={chip} pressed={mute} onPressedChange={onMute} label={`Mute ${title}`}>
        Mute
      </ToggleChip>
      <ToggleChip
        size="md"
        className={chip}
        pressed={mono > 0}
        mixed={mono === 2}
        onClick={(e) => {
          e.preventDefault();
          onMono(((mono + 1) % 3) as 0 | 1 | 2);
        }}
        label={`${title} mono: ${MONO_LABEL[mono]}`}
        tooltip={`Mono: ${MONO_LABEL[mono]} (click to cycle)`}
      >
        {mono === 2 ? "Rev" : "Mono"}
      </ToggleChip>
      <ToggleChip
        size="md"
        className={chip}
        pressed={eqOn}
        onPressedChange={onEq}
        label={`${title} EQ ${eqOn ? "on" : "off"}`}
        tooltip={onOpenEq ? "EQ on/off · right-click for the editor" : "EQ on/off"}
        onContextMenu={
          onOpenEq
            ? (e) => {
                e.preventDefault();
                onOpenEq();
              }
            : undefined
        }
      >
        EQ
      </ToggleChip>
      <ToggleChip size="md" className={chip} pressed={sel} onPressedChange={onSel} label={`Select ${title}`} tooltip="Select (Sel)">
        Sel
      </ToggleChip>
    </div>
  );
}
