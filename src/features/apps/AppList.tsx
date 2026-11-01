/**
 * Apps zone of a virtual strip: one `AppRow` per app, sorted by name,
 * scrolling inside the zone when full, with a quiet "Windows mixer" link at the bottom.
 * States fit a 100px-wide zone: skeleton rows, "No apps playing" + Route apps…, endpoint not
 * found, and "Apps unavailable" with Re-scan. Renders `null` when apps are off, which puts the
 * strip back on its 5-zone layout.
 */
import { useState, type ReactNode } from "react";
import { ArrowUpRight, CircleAlert, RotateCw } from "lucide-react";
import { Skeleton } from "@/components/ui";
import type { SessionTarget } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { useNavigation } from "@/stores/navigationStore";
import { AppRow } from "./AppRow";
import { openSoundSettings, rescanApps, useAppsView } from "./useApps";

const link =
  "inline-flex items-center gap-0.5 rounded-sm text-11 text-text-dim underline decoration-line-strong underline-offset-2 transition-colors duration-150 ease-out hover:text-text hover:decoration-text-dim";

function Center({ children, role }: { children: ReactNode; role?: "alert" | "status" }) {
  return (
    <div role={role} className="flex h-full min-h-0 flex-col items-center justify-center gap-1 overflow-hidden px-2 py-2 text-center">
      {children}
    </div>
  );
}

function RescanLink() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={cn(link, busy && "pointer-events-none opacity-60")}
      onClick={async () => {
        setBusy(true);
        try {
          await rescanApps();
        } finally {
          setBusy(false);
        }
      }}
    >
      <RotateCw size={11} strokeWidth={1.5} aria-hidden className={busy ? "animate-spin" : undefined} />
      Re-scan
    </button>
  );
}

function SkeletonRows() {
  return (
    <div aria-busy aria-label="Loading apps" className="flex flex-col gap-1 px-[3px] py-1">
      {[0, 1].map((k) => (
        <div key={k} className="flex h-[44px] flex-col justify-center gap-1.5 px-1">
          <div className="flex items-center gap-1.5">
            <Skeleton className="size-5 shrink-0 rounded-[4px]" />
            <Skeleton className="h-2.5 flex-1" />
          </div>
          <Skeleton className="h-[3px] w-full rounded-full" />
        </div>
      ))}
    </div>
  );
}

export interface AppListProps {
  target: SessionTarget;
}

export function AppList({ target }: AppListProps) {
  const view = useAppsView(target);
  const navigate = useNavigation((s) => s.navigate);

  switch (view.kind) {
    case "off":
      return null;
    case "loading":
      return <SkeletonRows />;
    case "error":
      return (
        <Center role="alert">
          <CircleAlert size={14} strokeWidth={1.5} className="text-mute" aria-hidden />
          <span className="text-12 text-text">Apps unavailable</span>
          <span title={view.message} className="line-clamp-2 text-11 break-words text-text-faint">
            {view.message}
          </span>
          <RescanLink />
        </Center>
      );
    case "missing":
      return (
        <Center role="status">
          <span className="text-12 text-text">Not found</span>
          <span className="text-11 text-text-faint">This input's Windows device isn't active.</span>
          <button type="button" className={link} onClick={() => openSoundSettings("sound")}>
            Sound settings
            <ArrowUpRight size={11} strokeWidth={1.5} aria-hidden />
          </button>
          <span className="flex gap-2">
            <RescanLink />
            <button type="button" className={link} onClick={() => navigate("settings")}>
              Mapping
            </button>
          </span>
        </Center>
      );
    case "ready":
      break;
  }

  const { apps, ep } = view;
  if (apps.length === 0) {
    return (
      <Center>
        <span className="text-12 text-text-dim">No apps playing</span>
        <button
          type="button"
          className={link}
          title={`Pick "${ep.endpoint ?? "this input"}" as an app's output in the Windows volume mixer`}
          onClick={() => openSoundSettings("volume-mixer")}
        >
          Route apps…
          <ArrowUpRight size={11} strokeWidth={1.5} aria-hidden />
        </button>
      </Center>
    );
  }

  return (
    <div className="@container flex h-full min-h-0 flex-col">
      <ul
        aria-label={`Apps playing into ${ep.endpoint ?? "this input"}`}
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-x-hidden overflow-y-auto px-[3px] py-1 [scrollbar-width:thin]"
      >
        {apps.map((app) => (
          <AppRow key={app.key} app={app} />
        ))}
      </ul>
      <button
        type="button"
        title="Open Windows volume mixer"
        aria-label="Open Windows volume mixer"
        onClick={() => openSoundSettings("volume-mixer")}
        className="flex h-5 shrink-0 items-center justify-center gap-0.5 truncate px-1 text-11 text-text-faint transition-colors duration-150 ease-out hover:text-text"
      >
        Windows mixer
        <ArrowUpRight size={11} strokeWidth={1.5} aria-hidden />
      </button>
    </div>
  );
}

/** The registered `StripApps` slot: the app list for virtual strip `strip` (5–7). */
export function StripApps({ strip }: { strip: number }) {
  return <AppList target={{ kind: "strip", index: strip }} />;
}
