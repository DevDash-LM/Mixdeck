/**
 * User-resized Mixer panels, kept per machine in localStorage (a view convenience, not a setting).
 *  - `split`: Hardware / Master widths as fractions of the board's resizable width (Virtual gets
 *    the rest). `null` = the default auto layout (strips 108–168px, centred).
 *  - `virtFader`: the virtual strips' fader-zone height in px when an Apps zone is shown.
 *    `null` = the default 230px.
 */
import { create } from "zustand";

export interface PanelSplit {
  hw: number;
  master: number;
}

interface PanelLayoutState {
  split: PanelSplit | null;
  virtFader: number | null;
  /** `persist: false` while dragging; the drag end saves. */
  setSplit: (split: PanelSplit | null, persist?: boolean) => void;
  setVirtFader: (h: number | null, persist?: boolean) => void;
  persist: () => void;
}

const KEY = "mixdeck.mixer.panels";

function load(): Pick<PanelLayoutState, "split" | "virtFader"> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { split: null, virtFader: null };
    const v = JSON.parse(raw) as { split?: unknown; virtFader?: unknown };
    const s = v.split as Partial<PanelSplit> | null | undefined;
    const split =
      s && typeof s.hw === "number" && typeof s.master === "number" && s.hw > 0 && s.master > 0 && s.hw + s.master < 1
        ? { hw: s.hw, master: s.master }
        : null;
    const virtFader = typeof v.virtFader === "number" && v.virtFader > 0 ? v.virtFader : null;
    return { split, virtFader };
  } catch {
    return { split: null, virtFader: null };
  }
}

function save(s: Pick<PanelLayoutState, "split" | "virtFader">) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ split: s.split, virtFader: s.virtFader }));
  } catch {
    // Storage blocked: the layout just doesn't survive a restart.
  }
}

export const usePanelLayout = create<PanelLayoutState>((set, get) => ({
  ...load(),
  setSplit: (split, persist = true) => {
    set({ split });
    if (persist) save(get());
  },
  setVirtFader: (virtFader, persist = true) => {
    set({ virtFader });
    if (persist) save(get());
  },
  persist: () => save(get()),
}));

export const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
