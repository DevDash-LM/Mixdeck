/**
 * Apps on strips: one view model per target, shared by the strip's Apps zone,
 * its endpoint card, the B-row listening apps and Settings › Apps. Built only from the sessions
 * surface (`useSessions`, `useSessionsStore`) plus `Settings.apps`.
 */
import { useEffect, useMemo } from "react";
import { toast } from "@/components/ui";
import {
  bridge,
  errorMessage,
  inTauri,
  type AppSession,
  type AppsSettings,
  type EndpointApps,
  type SessionTarget,
  type SoundSettingsPage,
} from "@/lib/bridge";
import { useSessions, useSessionsStore } from "@/stores/sessionsStore";
import { useSettings } from "@/stores/settingsStore";
import { appLabelKey, useAppLabels } from "./appLabels";

/** Same as the Rust default (`AppsSettings::default`), used until Settings has loaded. */
export const DEFAULT_APPS_SETTINGS: AppsSettings = {
  enabled: true,
  showSystemSounds: false,
  monochromeIcons: false,
  showInactive: true,
  endpointRules: [],
};

/** `Settings.apps`, loading Settings once if nothing has yet (the Mixer renders before Settings). */
export function useAppsSettings(): AppsSettings {
  const status = useSettings((s) => s.status);
  const apps = useSettings((s) => s.settings?.apps);
  useEffect(() => {
    if (status === "idle" && inTauri) void useSettings.getState().load();
  }, [status]);
  return apps ?? DEFAULT_APPS_SETTINGS;
}

/** An app as the UI shows it: `name` is the local rename if there is one, else Windows' name. */
export type AppItem = AppSession & {
  /** Windows' name for the app (what `name` would be without a rename). */
  defaultName: string;
  /** Key into `Settings.appLabels`. */
  labelKey: string;
};

export type AppsView =
  /** Apps turned off in Settings, or there's no backend (plain browser tab). Render nothing / a quiet note. */
  | { kind: "off" }
  | { kind: "loading" }
  /** Windows audio (or the bridge) failed. `message` is user-readable. */
  | { kind: "error"; message: string }
  /** No active Windows endpoint matched this target. */
  | { kind: "missing"; ep: EndpointApps | undefined }
  /** `apps` is filtered by the Settings toggles, renamed, and sorted by name (stable while dragging). */
  | { kind: "ready"; ep: EndpointApps; apps: AppItem[] };

const byName = (a: AppSession, b: AppSession) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.key.localeCompare(b.key);

export function useAppsView(target: SessionTarget): AppsView {
  const settings = useAppsSettings();
  const bridgeStatus = useSessionsStore((s) => s.status);
  const bridgeError = useSessionsStore((s) => s.error);
  const status = useSessionsStore((s) => s.state?.status);
  const stateError = useSessionsStore((s) => s.state?.error ?? null);
  const ep = useSessions(target);
  const showInactive = settings.showInactive;
  const labels = useAppLabels();

  return useMemo<AppsView>(() => {
    if (!inTauri || !settings.enabled || status === "disabled") return { kind: "off" };
    if (bridgeStatus === "error") return { kind: "error", message: bridgeError ?? "Couldn't reach the app list." };
    if (status === "unavailable") return { kind: "error", message: stateError ?? "Windows audio isn't responding." };
    if (status !== "ready") return { kind: "loading" };
    if (!ep || !ep.found) return { kind: "missing", ep };
    const apps = (showInactive ? ep.apps : ep.apps.filter((a) => a.active))
      .map((a): AppItem => {
        const labelKey = appLabelKey(a);
        return { ...a, name: labels[labelKey] ?? a.name, defaultName: a.name, labelKey };
      })
      .sort(byName);
    return { kind: "ready", ep, apps };
  }, [settings.enabled, status, bridgeStatus, bridgeError, stateError, ep, showInactive, labels]);
}

/** Re-scan (also retries Windows audio / the bridge after a failure). Toasts on failure. */
export async function rescanApps(): Promise<void> {
  const s = useSessionsStore.getState();
  try {
    if (s.status === "error" || s.status === "idle") await s.init();
    else await s.rescan();
  } catch (err) {
    toast.error("Couldn't re-scan apps", { description: errorMessage(err) });
  }
}

/** Opens Windows Settings (volume mixer or Sound). Toasts on failure. */
export function openSoundSettings(page: SoundSettingsPage): void {
  bridge.openSoundSettings(page).catch((err: unknown) => {
    toast.error("Couldn't open Windows settings", { description: errorMessage(err) });
  });
}

/** "1 app" / "3 apps". */
export const appCount = (n: number) => (n === 1 ? "1 app" : `${n} apps`);

/** Linear peak → "is producing sound" (> −50 dB). */
export const LIVE_THRESHOLD = 10 ** (-50 / 20);
