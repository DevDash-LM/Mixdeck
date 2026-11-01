/**
 * Local app renames. Stored in `Settings.appLabels` (Mixdeck only: Windows and Voicemeeter never
 * see them). An app is identified by its exe path, so a rename sticks across sessions and
 * restarts; apps without a readable path fall back to their Windows name.
 */
import { toast } from "@/components/ui";
import { errorMessage, type AppSession } from "@/lib/bridge";
import { useSettings } from "@/stores/settingsStore";

/** Same limit as the Rust side (`MAX_APP_LABEL_LEN`). */
export const APP_LABEL_MAX = 64;

const EMPTY: Readonly<Record<string, string>> = Object.freeze({});

/** Identity key for `Settings.appLabels`. */
export function appLabelKey(app: Pick<AppSession, "exe" | "name" | "system">): string {
  if (app.system) return "system";
  if (app.exe) return `exe:${app.exe.toLowerCase()}`;
  return `name:${app.name}`;
}

/** Human-readable form of a key, for Settings ("chrome.exe", "System sounds"). */
export function describeAppLabelKey(key: string): string {
  if (key === "system") return "System sounds";
  if (key.startsWith("exe:")) return key.slice(4).split(/[\\/]/).pop() || key.slice(4);
  if (key.startsWith("name:")) return key.slice(5);
  return key;
}

/** The current renames (empty until Settings has loaded). */
export function useAppLabels(): Readonly<Record<string, string>> {
  return useSettings((s) => s.settings?.appLabels) ?? EMPTY;
}

/** Sets (or, with an empty `label`, clears) the local name for `key`. Toasts on failure. */
export async function setAppLabel(key: string, label: string): Promise<void> {
  const store = useSettings.getState();
  try {
    // The patch replaces the whole map, so never write one built from settings we haven't read.
    if (!store.settings) await store.load();
    const current = useSettings.getState().settings;
    if (!current) throw new Error("Settings aren't available right now.");
    const next = { ...current.appLabels };
    const trimmed = label.trim().slice(0, APP_LABEL_MAX);
    if (trimmed) next[key] = trimmed;
    else delete next[key];
    await useSettings.getState().update({ appLabels: next });
  } catch (err) {
    toast.error("Couldn't rename the app", { description: errorMessage(err) });
  }
}
