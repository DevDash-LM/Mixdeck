/**
 * Presets: the list (kept fresh by `presets://changed`), the global "Save preset"
 * dialog, and load/rename/delete helpers that toast their results.
 */
import { useEffect } from "react";
import { create } from "zustand";
import { toast } from "@/components/ui";
import { bridge, errorMessage, inTauri, presetEvents, type LoadReport, type PresetSummary } from "@/lib/bridge";
import { BUS_EQ_GROUP } from "@/features/bus-eq/busEqStore";
import { STRIP_FX_GROUP } from "@/features/strip-fx/stripFxStore";
import { BUSES, STRIPS } from "@/lib/params";

export const PRESETS_VIEW = "presets";
export const CORE_GROUP = "core";

/** What the Save dialog offers, mapped to engine group ids. */
export interface PresetSection {
  key: "core" | "stripFx" | "busEq";
  label: string;
  description: string;
  ids: string[];
}

export const PRESET_SECTIONS: readonly PresetSection[] = [
  {
    key: "core",
    label: "Mixer",
    description: "Gains, mutes, solo, routing, labels, strip knobs, bus modes and EQ on/off.",
    ids: [CORE_GROUP],
  },
  {
    key: "stripFx",
    label: "Strip effects",
    description: "Limiter, compressor, gate and parametric EQ on all 8 inputs.",
    ids: Array.from({ length: STRIPS }, (_, i) => STRIP_FX_GROUP(i)),
  },
  {
    key: "busEq",
    label: "Bus EQ",
    description: "Parametric EQ, trim and delay on all 8 buses.",
    ids: Array.from({ length: BUSES }, (_, j) => BUS_EQ_GROUP(j)),
  },
];

/** Short labels for a preset's group list ("Mixer", "Strip effects", "Bus EQ (2 of 8)"). */
export function describeGroups(groups: readonly string[]): string[] {
  const set = new Set(groups);
  const out: string[] = [];
  for (const s of PRESET_SECTIONS) {
    const n = s.ids.filter((id) => set.has(id)).length;
    if (n === 0) continue;
    out.push(n === s.ids.length || s.ids.length === 1 ? s.label : `${s.label} (${n} of ${s.ids.length})`);
  }
  return out;
}

export function formatSavedAt(ms: number): string {
  if (!ms) return "Unknown date";
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

type Status = "idle" | "loading" | "ready" | "error";

interface PresetsStore {
  list: PresetSummary[];
  status: Status;
  error: string | null;
  refresh: () => Promise<void>;
  /** Global Save dialog (title bar, Routing, Presets view). */
  saveOpen: boolean;
  openSave: () => void;
  setSaveOpen: (open: boolean) => void;
}

let listening = false;

export const usePresets = create<PresetsStore>((set, get) => ({
  list: [],
  status: "idle",
  error: null,
  refresh: async () => {
    if (!listening && inTauri) {
      listening = true;
      presetEvents.onChanged((list) => set({ list, status: "ready", error: null })).catch(() => {
        listening = false;
      });
    }
    if (get().status !== "ready") set({ status: "loading", error: null });
    try {
      const list = await bridge.listPresets();
      set({ list, status: "ready", error: null });
    } catch (err) {
      set({ status: "error", error: errorMessage(err) });
    }
  },
  saveOpen: false,
  openSave: () => set({ saveOpen: true }),
  setSaveOpen: (saveOpen) => set({ saveOpen }),
}));

/** Loads the list on first use. Later updates arrive through `presets://changed`. */
export function useEnsurePresets(): void {
  const status = usePresets((s) => s.status);
  const refresh = usePresets((s) => s.refresh);
  useEffect(() => {
    if (status === "idle") void refresh();
  }, [status, refresh]);
}

/** Loads a preset and toasts the result. Rejects (with a readable message) on failure. */
export async function loadPreset(id: string): Promise<LoadReport> {
  let report: LoadReport;
  try {
    report = await bridge.loadPreset(id);
  } catch (err) {
    throw new Error(errorMessage(err));
  }
  if (report.errors.length === 0) {
    toast.success(`Loaded “${report.name}”`, {
      description: report.skipped > 0 ? `${report.skipped} unknown values in the file were ignored.` : undefined,
    });
  } else {
    toast.error(`Loaded “${report.name}” with ${report.errors.length} error${report.errors.length === 1 ? "" : "s"}`, {
      description: report.errors.slice(0, 3).join(" ") + (report.errors.length > 3 ? " …" : ""),
    });
  }
  return report;
}
