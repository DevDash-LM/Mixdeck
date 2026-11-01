/**
 * Source zone: one 50px card, identical frame on both strip kinds.
 * HW: the registered `DevicePicker` (card variant); without one, a static card with a
 * "coming soon" tooltip. Virtual: the registered `StripSource` (EndpointCard); without one,
 * "Desktop audio" + "Apps appear here".
 */
import { ChevronDown } from "lucide-react";
import { Tooltip } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { DevicePicker } from "../extensions";
import { getStripSource } from "../extensions";

const frame = "flex h-[50px] w-full min-w-0 rounded-md border border-line bg-panel-2";

export function SourceCard({
  index,
  hardware,
  device,
  Picker,
}: {
  index: number;
  hardware: boolean;
  device: string | null;
  Picker: DevicePicker | undefined;
}) {
  if (hardware) {
    if (Picker) return <Picker index={index} current={device} variant="card" />;
    return <StaticDeviceCard device={device} />;
  }
  const Source = getStripSource("virtual");
  if (Source) return <Source strip={index} />;
  return (
    <div className={cn(frame, "flex-col justify-center gap-0.5 px-2")}>
      <span className="truncate text-12 leading-[14px] text-text">Desktop audio</span>
      <span className="truncate text-11 leading-[14px] text-text-faint">Apps appear here</span>
    </div>
  );
}

function StaticDeviceCard({ device }: { device: string | null }) {
  const name = device?.trim() || "No device";
  return (
    <Tooltip
      content={
        <span className="flex max-w-64 flex-col gap-0.5">
          <span className="break-words">{name}</span>
          <span className="text-11 text-text-faint">Device selection is coming soon</span>
        </span>
      }
    >
      <button
        type="button"
        aria-disabled
        aria-label={`Device: ${name}. Device selection is coming soon`}
        className={cn(frame, "relative cursor-default py-1.5 pr-1 pl-2 text-left")}
      >
        <span className={cn("line-clamp-2 min-w-0 text-12 leading-[14px] break-words", device ? "text-text" : "text-text-faint")}>
          {name}
        </span>
        <span className="absolute right-1 bottom-1.5">
          <ChevronDown size={12} strokeWidth={1.5} className="text-text-faint" aria-hidden />
        </span>
      </button>
    </Tooltip>
  );
}
