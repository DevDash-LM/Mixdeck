/**
 * Footer zone: 2×2 buttons, 28px (`ToggleChip size="md"`).
 * HW: Mute · Solo · Mono · FX (opens Strip FX). Virtual: Mute · Solo · MC · EQ.
 */
import { Tooltip } from "@/components/ui";
import { ToggleChip } from "@/components/mixer";
import { cn } from "@/lib/cn";

export interface StripFooterProps {
  name: string;
  hardware: boolean;
  mute: boolean;
  solo: boolean;
  /** HW: Mono. Virtual: MC (mute centre). */
  mono: boolean;
  /** Virtual only: EQ on/off. */
  eqOn: boolean;
  onMute: (on: boolean) => void;
  onSolo: (on: boolean) => void;
  onMono: (on: boolean) => void;
  onEq: (on: boolean) => void;
  /** Open the Strip FX panel (HW FX button; right-click on virtual EQ). Absent = disabled. */
  onOpenFx?: (tab?: "eq") => void;
}

export function StripFooter({
  name,
  hardware,
  mute,
  solo,
  mono,
  eqOn,
  onMute,
  onSolo,
  onMono,
  onEq,
  onOpenFx,
}: StripFooterProps) {
  return (
    <div className="grid grid-cols-2 content-center gap-1.5 px-1.5">
      <ToggleChip size="md" tone="mute" pressed={mute} onPressedChange={onMute} label={`Mute ${name}`}>
        Mute
      </ToggleChip>
      <ToggleChip size="md" tone="solo" pressed={solo} onPressedChange={onSolo} label={`Solo ${name}`}>
        Solo
      </ToggleChip>
      {hardware ? (
        <>
          <ToggleChip size="md" pressed={mono} onPressedChange={onMono} label={`${name} mono`}>
            Mono
          </ToggleChip>
          <FxButton name={name} onOpen={onOpenFx ? () => onOpenFx() : undefined} />
        </>
      ) : (
        <>
          <ToggleChip size="md" pressed={mono} onPressedChange={onMono} label={`${name} mute center channel`} tooltip="Mute center channel">
            MC
          </ToggleChip>
          <ToggleChip
            size="md"
            pressed={eqOn}
            onPressedChange={onEq}
            label={`${name} EQ ${eqOn ? "on" : "off"}`}
            tooltip={onOpenFx ? "EQ on/off · right-click for the EQ panel" : "EQ on/off"}
            onContextMenu={
              onOpenFx
                ? (e) => {
                    e.preventDefault();
                    onOpenFx("eq");
                  }
                : undefined
            }
          >
            EQ
          </ToggleChip>
        </>
      )}
    </div>
  );
}

/** Not a toggle: opens the Strip FX drawer (fixes A7, "hidden essentials"). */
function FxButton({ name, onOpen }: { name: string; onOpen: (() => void) | undefined }) {
  const button = (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={`${name} effects`}
      aria-disabled={onOpen ? undefined : true}
      onClick={onOpen}
      className={cn(
        "inline-flex h-[var(--ctl-md)] min-w-0 items-center justify-center rounded-md border border-line bg-panel-2 px-1.5 text-12 font-medium",
        "transition-colors duration-120 ease-out",
        onOpen ? "text-text-dim hover:border-line-strong hover:text-text" : "cursor-default text-text-faint opacity-60",
      )}
    >
      FX
    </button>
  );
  return <Tooltip content={onOpen ? "Effects: EQ, compressor, gate" : "Effects are coming soon"}>{button}</Tooltip>;
}
