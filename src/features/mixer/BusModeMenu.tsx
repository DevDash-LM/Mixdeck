/** Bus mode chip + menu (`Bus[j].mode.*`). */
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui";
import type { BusMode } from "@/lib/bridge";
import { BUS_MODES } from "@/lib/params";
import { cn } from "@/lib/cn";
import { BUS_MODE_GROUPS, BUS_MODE_LABEL } from "./labels";

export interface BusModeMenuProps {
  mode: BusMode;
  onChange: (mode: BusMode) => void;
  /** Bus display name, for the accessible label ("A1"). */
  busLabel: string;
  disabled?: boolean;
  className?: string;
}

export function BusModeMenu({ mode, onChange, busLabel, disabled, className }: BusModeMenuProps) {
  const isNormal = mode === "normal";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={`${busLabel} mode: ${BUS_MODE_LABEL[mode].full}`}
          title={BUS_MODE_LABEL[mode].full}
          className={cn(
            "flex h-[22px] w-full min-w-0 items-center gap-0.5 rounded-md border pr-0.5 pl-1.5 text-left text-11 font-medium",
            "transition-colors duration-150 ease-out disabled:opacity-40",
            isNormal
              ? "border-line bg-panel-2 text-text-dim hover:border-line-strong hover:text-text"
              : "border-line-strong bg-panel-2 text-text",
            "data-[state=open]:border-text-faint",
            className,
          )}
        >
          <span className="min-w-0 flex-1 truncate">{BUS_MODE_LABEL[mode].short}</span>
          <ChevronDown size={12} strokeWidth={1.5} className="shrink-0 text-text-faint" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        <DropdownMenuLabel>{busLabel} mode</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={(v) => {
            const next = BUS_MODES.find((m) => m === v);
            if (next && next !== mode) onChange(next);
          }}
        >
          {BUS_MODE_GROUPS.map((group, gi) => (
            <div key={gi}>
              {gi > 0 ? <DropdownMenuSeparator /> : null}
              {group.map((m) => (
                <DropdownMenuRadioItem key={m} value={m}>
                  {BUS_MODE_LABEL[m].full}
                </DropdownMenuRadioItem>
              ))}
            </div>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
