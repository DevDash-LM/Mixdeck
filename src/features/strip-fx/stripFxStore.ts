/** Which strip the Strip FX drawer shows, and on which tab. */
import { create } from "zustand";
import type { StripFxTab } from "@/features/mixer/extensions";
import { STRIPS } from "@/lib/params";

interface StripFxStore {
  open: boolean;
  strip: number;
  tab: StripFxTab;
  /** Opens the drawer on strip `i`; keeps the last tab unless one is given. */
  openFx: (i: number, tab?: StripFxTab) => void;
  close: () => void;
  /** Moves to the previous (-1) or next (+1) strip, wrapping around. */
  step: (dir: -1 | 1) => void;
  setTab: (tab: StripFxTab) => void;
}

export const useStripFx = create<StripFxStore>((set, get) => ({
  open: false,
  strip: 0,
  tab: "eq",
  openFx: (i, tab) => set({ open: true, strip: Math.min(STRIPS - 1, Math.max(0, i)), tab: tab ?? get().tab }),
  close: () => set({ open: false }),
  step: (dir) => set({ strip: (get().strip + dir + STRIPS) % STRIPS }),
  setTab: (tab) => set({ tab }),
}));

export const STRIP_FX_GROUP = (i: number) => `strip_fx:${i}`;
