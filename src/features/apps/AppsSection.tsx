/**
 * Settings › Apps: show apps on strips, hide system sounds, show inactive
 * apps, monochrome icons, and the endpoint mapping status (endpoint → strip/bus, found or
 * not) with Re-scan.
 */
import { useState } from "react";
import { RotateCw } from "lucide-react";
import { Button, Skeleton, Toggle } from "@/components/ui";
import { inTauri, type AppsSettings, type EndpointApps, type SessionTarget } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { busName, stripDefaultName } from "@/features/mixer/labels";
import type { SettingsSectionProps } from "@/features/settings/sections";
import { useSessionsStore } from "@/stores/sessionsStore";
import { appCount, rescanApps } from "./useApps";

const TARGETS: SessionTarget[] = [
  { kind: "strip", index: 5 },
  { kind: "strip", index: 6 },
  { kind: "strip", index: 7 },
  { kind: "bus", index: 5 },
  { kind: "bus", index: 6 },
  { kind: "bus", index: 7 },
];

const targetName = (t: SessionTarget) =>
  t.kind === "strip" ? `${stripDefaultName(t.index)} (input)` : `${busName(t.index)} (bus)`;

function MappingStatus({ rules }: { rules: AppsSettings["endpointRules"] }) {
  const bridgeStatus = useSessionsStore((s) => s.status);
  const bridgeError = useSessionsStore((s) => s.error);
  const state = useSessionsStore((s) => s.state);
  const [busy, setBusy] = useState(false);

  const rescan = async () => {
    setBusy(true);
    try {
      await rescanApps();
    } finally {
      setBusy(false);
    }
  };

  let body;
  if (!inTauri) {
    body = <p className="text-12 text-text-dim">Endpoints are checked in the desktop app only.</p>;
  } else if (bridgeStatus === "error" || state?.status === "unavailable") {
    body = (
      <p role="alert" className="text-12 text-text-dim">
        <span className="text-mute">Apps unavailable.</span>{" "}
        {(bridgeStatus === "error" ? bridgeError : state?.error) ?? "Windows audio isn't responding."} Re-scan to try again.
      </p>
    );
  } else if (state?.status === "disabled") {
    body = <p className="text-12 text-text-dim">Turn on “Show apps on strips” to check which Windows devices feed each input and bus.</p>;
  } else if (!state || state.status !== "ready") {
    body = (
      <div aria-busy aria-label="Checking endpoints" className="flex flex-col gap-2">
        {TARGETS.map((t) => (
          <Skeleton key={`${t.kind}${t.index}`} className="h-4 w-full" />
        ))}
      </div>
    );
  } else {
    const find = (t: SessionTarget): EndpointApps | undefined =>
      state.endpoints.find((e) => e.target.kind === t.kind && e.target.index === t.index);
    body = (
      <ul className="flex flex-col divide-y divide-line">
        {TARGETS.map((t) => {
          const ep = find(t);
          const found = ep?.found ?? false;
          const overridden = rules.some((r) => r.target.kind === t.kind && r.target.index === t.index);
          return (
            <li key={`${t.kind}${t.index}`} className="flex items-center gap-3 py-1.5 text-12">
              <span className="w-32 shrink-0 text-text">{targetName(t)}</span>
              <span className={cn("min-w-0 flex-1 truncate", found ? "text-text-dim" : "text-text-faint")} title={ep?.endpoint ?? undefined}>
                {ep?.endpoint ?? "—"}
                {overridden ? <span className="ml-1.5 text-11 text-text-faint">(override)</span> : null}
              </span>
              <span className="tabular w-14 shrink-0 text-right text-11 text-text-faint">{found && ep ? appCount(ep.apps.length) : ""}</span>
              <span className="flex w-20 shrink-0 items-center justify-end gap-1.5">
                <span aria-hidden className={cn("size-1.5 rounded-full", found ? "bg-meter-lo" : "bg-mute")} />
                <span className={found ? "text-text-dim" : "text-text"}>{found ? "Found" : "Not found"}</span>
              </span>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-2 pt-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col">
          <span className="text-13 text-text">Endpoint mapping</span>
          <span className="text-12 text-text-dim">Windows devices matched to the virtual inputs and B buses by name.</span>
        </div>
        <Button
          size="sm"
          onClick={rescan}
          loading={busy}
          disabled={!inTauri}
          icon={<RotateCw size={14} strokeWidth={1.5} />}
        >
          Re-scan
        </Button>
      </div>
      {body}
    </div>
  );
}

export default function AppsSection({ settings, update }: SettingsSectionProps) {
  const apps = settings.apps;
  const set = (patch: Partial<AppsSettings>) => {
    update({ apps: { ...apps, ...patch } }).catch(() => undefined);
  };
  const off = !apps.enabled;

  return (
    <div className="flex flex-col divide-y divide-line">
      <Toggle
        className="py-3 first:pt-0"
        label="Show apps on strips"
        description="List the apps playing into each virtual input, with their Windows volume and mute, and the apps recording from B1–B3."
        checked={apps.enabled}
        onCheckedChange={(v) => set({ enabled: v })}
      />
      <Toggle
        className="py-3"
        label="Hide system sounds"
        description="Leave out the Windows “System sounds” session (notification and alert sounds)."
        checked={!apps.showSystemSounds}
        disabled={off}
        onCheckedChange={(v) => set({ showSystemSounds: !v })}
      />
      <Toggle
        className="py-3"
        label="Show inactive apps"
        description="Keep apps that aren't playing right now in the list, dimmed."
        checked={apps.showInactive}
        disabled={off}
        onCheckedChange={(v) => set({ showInactive: v })}
      />
      <Toggle
        className="py-3"
        label="Monochrome icons"
        description="Draw app icons in greyscale to match the rest of the board."
        checked={apps.monochromeIcons}
        disabled={off}
        onCheckedChange={(v) => set({ monochromeIcons: v })}
      />
      <MappingStatus rules={apps.endpointRules} />
    </div>
  );
}
