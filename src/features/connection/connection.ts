/** Connection helpers shared by the connection screen and the title-bar pill. */
import { useEffect } from "react";
import { create } from "zustand";
import { bridge, inTauri, type ConnectionState, type EngineInfo, type VmEdition } from "@/lib/bridge";
import { useMixer } from "@/stores/mixerStore";

export const DOWNLOAD_URL = "https://vb-audio.com/Voicemeeter/potato.htm";

/** Demo mode is offered in dev builds only. */
export const DEMO_AVAILABLE = import.meta.env.DEV;

export const editionName = (e: VmEdition) =>
  e === "potato" ? "Voicemeeter Potato" : e === "banana" ? "Voicemeeter Banana" : "Voicemeeter";

export type Tone = "ok" | "waiting" | "error";

export function connectionTone(c: ConnectionState): Tone {
  switch (c.status) {
    case "connected":
      return "ok";
    case "starting":
    case "notRunning":
      return "waiting";
    default:
      return "error";
  }
}

/** Short status for the pill. */
export function shortStatus(c: ConnectionState, info: EngineInfo | null): string {
  switch (c.status) {
    case "starting":
      return "Connecting…";
    case "connected":
      return info?.backend === "fake" ? "Demo engine" : `Potato ${c.version}`;
    case "notRunning":
      return "Not running";
    case "wrongEdition":
      return "Wrong edition";
    case "dllNotFound":
      return "Not installed";
    case "dllError":
    case "loginFailed":
      return "Can't connect";
  }
}

/** One-line description for the details popover. */
export function longStatus(c: ConnectionState): string {
  switch (c.status) {
    case "starting":
      return "Looking for Voicemeeter…";
    case "connected":
      return `Connected to ${editionName(c.vmType)} ${c.version}.`;
    case "notRunning":
      return "Voicemeeter isn't running. Mixdeck checks again every second.";
    case "wrongEdition":
      return `${editionName(c.vmType)} is running. Mixdeck needs Voicemeeter Potato.`;
    case "dllNotFound":
      return "Voicemeeter isn't installed on this PC.";
    case "dllError":
      return c.message;
    case "loginFailed":
      return c.message;
  }
}

interface EngineInfoStore {
  info: EngineInfo | null;
  refresh: () => Promise<void>;
  /** Switches demo mode and stores the engine info it returns. */
  setDemo: (enabled: boolean) => Promise<void>;
}

export const useEngineInfoStore = create<EngineInfoStore>((set) => ({
  info: null,
  refresh: async () => {
    if (!inTauri) return;
    try {
      set({ info: await bridge.getEngineInfo() });
    } catch {
      // Keep the last known info.
    }
  },
  setDemo: async (enabled) => {
    set({ info: await bridge.setDemoMode(enabled) });
  },
}));

/** Engine info (real/demo backend, DLL path), refreshed whenever the connection changes. */
export function useEngineInfo(): EngineInfo | null {
  const status = useMixer((s) => s.connection.status);
  const info = useEngineInfoStore((s) => s.info);
  useEffect(() => {
    void useEngineInfoStore.getState().refresh();
  }, [status]);
  return info;
}
