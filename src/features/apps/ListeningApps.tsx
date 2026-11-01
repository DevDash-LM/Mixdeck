/**
 * B-bus row, line 1: apps recording from "Voicemeeter Out B1/B2/B3", as up
 * to three 18px icons + "OBS listening" / "OBS +1 listening". Falls back to the quiet "Virtual"
 * note when apps are off; unavailable/missing explain themselves in the tooltip. 22px tall.
 */
import { Skeleton, Tooltip } from "@/components/ui";
import { cn } from "@/lib/cn";
import { AppIcon } from "./AppIcon";
import { useAppsView } from "./useApps";

const MAX_ICONS = 3;

export interface ListeningAppsProps {
  bus: number;
}

function Quiet({ text, hint }: { text: string; hint?: string }) {
  const note = <span className="truncate px-1 text-11 text-text-faint">{text}</span>;
  if (!hint) return note;
  return (
    <Tooltip content={<span className="block max-w-64 break-words">{hint}</span>}>
      <span tabIndex={0} aria-label={`${text}. ${hint}`} className="flex min-w-0 rounded-sm">
        {note}
      </span>
    </Tooltip>
  );
}

export function ListeningApps({ bus }: ListeningAppsProps) {
  const view = useAppsView({ kind: "bus", index: bus });

  switch (view.kind) {
    case "off":
      return <Quiet text="Virtual" />;
    case "loading":
      return <Skeleton className="mx-1 h-3 w-20" />;
    case "error":
      return <Quiet text="Virtual" hint={`Listening apps unavailable: ${view.message}`} />;
    case "missing":
      return <Quiet text="Virtual" hint="This bus's Windows recording device wasn't found. Check Settings › Apps." />;
    case "ready":
      break;
  }

  // Recording apps first, then idle ones (both by name).
  const apps = [...view.apps].sort((a, b) => Number(b.active) - Number(a.active));
  if (apps.length === 0) return <Quiet text="No apps listening" hint={`Nothing is recording from ${view.ep.endpoint ?? "this bus"}.`} />;

  const first = apps[0];
  const label = `${first?.name ?? "App"}${apps.length > 1 ? ` +${apps.length - 1}` : ""} listening`;
  const full = apps.map((a) => `${a.name}${a.active ? "" : " (idle)"}${a.muted ? " (muted)" : ""}`).join(", ");

  return (
    <Tooltip
      content={
        <span className="flex max-w-64 flex-col gap-0.5">
          <span className="text-11 text-text-faint">Recording from {view.ep.endpoint ?? "this bus"}</span>
          <span className="break-words">{full}</span>
        </span>
      }
    >
      <span
        tabIndex={0}
        aria-label={`Listening: ${full}`}
        className="flex h-[22px] min-w-0 items-center gap-1 rounded-sm px-1"
      >
        <span className="flex shrink-0 items-center gap-0.5">
          {apps.slice(0, MAX_ICONS).map((a) => (
            <AppIcon key={a.key} app={a} size={18} className={cn(!a.active && "opacity-40")} />
          ))}
        </span>
        <span className="truncate text-11 text-text-dim">{label}</span>
      </span>
    </Tooltip>
  );
}
