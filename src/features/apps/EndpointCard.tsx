/**
 * Source zone of a virtual strip: the same 50px card frame as the HW
 * device card, showing the Windows endpoint that feeds the strip ("Voicemeeter Input") and how
 * many apps play into it. Clicking opens the Windows volume mixer (where apps are routed), or
 * Settings › Apps when the endpoint is missing, apps are off or unavailable.
 */
import { ArrowUpRight } from "lucide-react";
import { Skeleton, Tooltip } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useNavigation } from "@/stores/navigationStore";
import { appCount, openSoundSettings, useAppsView } from "./useApps";

const frame =
  "relative flex h-[50px] w-full min-w-0 flex-col justify-center gap-0.5 rounded-md border border-line bg-panel-2 py-[3px] pr-4 pl-2 text-left transition-colors duration-150 ease-out hover:border-line-strong";

export interface EndpointCardProps {
  strip: number;
}

export function EndpointCard({ strip }: EndpointCardProps) {
  const view = useAppsView({ kind: "strip", index: strip });
  const navigate = useNavigation((s) => s.navigate);

  if (view.kind === "loading") {
    return (
      <div aria-busy aria-label="Loading input" className={cn(frame, "hover:border-line")}>
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-2.5 w-2/5" />
      </div>
    );
  }

  let title: string;
  let sub: string;
  let hint: string;
  let tone = "text-text";
  let action: () => void;
  switch (view.kind) {
    case "ready": {
      const playing = view.apps.filter((a) => a.active).length;
      title = view.ep.endpoint ?? "Desktop audio";
      sub = view.apps.length === 0 ? "No apps" : appCount(view.apps.length);
      hint = `${title}: ${sub}${view.apps.length > 0 ? `, ${playing} playing` : ""}. Click to route apps in the Windows volume mixer.`;
      action = () => openSoundSettings("volume-mixer");
      break;
    }
    case "missing":
      title = "Not found";
      sub = "Check mapping";
      tone = "text-text-dim";
      hint = "No active Windows device matches this input. Click to check Settings › Apps.";
      action = () => navigate("settings");
      break;
    case "error":
      title = "Desktop audio";
      sub = "Apps unavailable";
      hint = `Apps unavailable: ${view.message}. Click to open Settings › Apps.`;
      action = () => navigate("settings");
      break;
    case "off":
      title = "Desktop audio";
      sub = "Apps hidden";
      hint = "Apps on strips are off. Click to turn them on in Settings › Apps.";
      action = () => navigate("settings");
      break;
  }

  return (
    <Tooltip content={<span className="block max-w-64 break-words">{hint}</span>}>
      <button type="button" aria-label={hint} onClick={action} className={frame}>
        <span className={cn("line-clamp-2 min-w-0 text-12 leading-[13px] break-words", tone)}>{title}</span>
        <span className="truncate text-11 leading-[13px] text-text-faint">{sub}</span>
        <span className="absolute right-1 bottom-1.5">
          <ArrowUpRight size={12} strokeWidth={1.5} className="text-text-faint" aria-hidden />
        </span>
      </button>
    </Tooltip>
  );
}
