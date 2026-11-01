/** Which bus the Bus EQ drawer shows. */
import { create } from "zustand";
import { BUSES } from "@/lib/params";

interface BusEqStore {
  open: boolean;
  bus: number;
  openEq: (j: number) => void;
  close: () => void;
  /** Previous (-1) or next (+1) bus, wrapping around. */
  step: (dir: -1 | 1) => void;
}

export const useBusEq = create<BusEqStore>((set, get) => ({
  open: false,
  bus: 0,
  openEq: (j) => set({ open: true, bus: Math.min(BUSES - 1, Math.max(0, j)) }),
  close: () => set({ open: false }),
  step: (dir) => set({ bus: (get().bus + dir + BUSES) % BUSES }),
}));

export const BUS_EQ_GROUP = (j: number) => `bus_eq:${j}`;
