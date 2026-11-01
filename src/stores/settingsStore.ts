import { create } from "zustand";
import { bridge, errorMessage, type Settings, type SettingsPatch } from "@/lib/bridge";

type Status = "idle" | "loading" | "ready" | "error";

interface SettingsStore {
  settings: Settings | null;
  status: Status;
  error: string | null;
  load: () => Promise<void>;
  /** Optimistically applies `patch`; reverts and rethrows (user-readable) on failure. */
  update: (patch: SettingsPatch) => Promise<void>;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: null,
  status: "idle",
  error: null,
  load: async () => {
    set({ status: "loading", error: null });
    try {
      const settings = await bridge.getSettings();
      set({ settings, status: "ready" });
    } catch (err) {
      set({ status: "error", error: errorMessage(err) });
    }
  },
  update: async (patch) => {
    const before = get().settings;
    if (before) set({ settings: { ...before, ...patch } as Settings });
    try {
      const settings = await bridge.setSettings(patch);
      set({ settings, status: "ready" });
    } catch (err) {
      set({ settings: before });
      throw new Error(errorMessage(err));
    }
  },
}));
