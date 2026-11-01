/**
 * Detail param groups (`strip_fx:{i}`, `bus_eq:{i}`, `devices`, …). `useGroup(id)` subscribes on
 * mount and unsubscribes on unmount; subscriptions are ref-counted so several components can
 * share one group. Data arrives on `mixer://group`.
 */
import { useEffect } from "react";
import { create } from "zustand";
import { bridge, engineEvents, errorMessage, inTauri } from "@/lib/bridge";

export type GroupStatus = "loading" | "ready" | "error";

export interface GroupEntry {
  data: unknown;
  error: string | null;
  status: GroupStatus;
}

interface GroupStore {
  entries: Record<string, GroupEntry>;
  init: () => Promise<void>;
}

const refs = new Map<string, number>();
let listening: Promise<void> | null = null;

export const useGroupStore = create<GroupStore>((set, get) => ({
  entries: {},
  init: () => {
    if (listening) return listening;
    listening = engineEvents
      .onGroup((ev) => {
        if (!refs.has(ev.id)) return; // late event for a group nobody watches any more
        const entry: GroupEntry = ev.error
          ? { data: get().entries[ev.id]?.data ?? null, error: ev.error, status: "error" }
          : { data: ev.data, error: null, status: "ready" };
        set({ entries: { ...get().entries, [ev.id]: entry } });
      })
      .then(() => undefined);
    return listening;
  },
}));

function setEntry(id: string, entry: GroupEntry | null) {
  const { [id]: _old, ...rest } = useGroupStore.getState().entries;
  useGroupStore.setState({ entries: entry ? { ...rest, [id]: entry } : rest });
}

function acquire(id: string) {
  const n = refs.get(id) ?? 0;
  refs.set(id, n + 1);
  if (n > 0) return;
  setEntry(id, { data: null, error: null, status: "loading" });
  if (!inTauri) {
    setEntry(id, { data: null, error: "Only available in the desktop app.", status: "error" });
    return;
  }
  void useGroupStore.getState().init();
  bridge.subscribeGroup(id).catch((err: unknown) => {
    setEntry(id, { data: null, error: errorMessage(err), status: "error" });
  });
}

function release(id: string) {
  const n = (refs.get(id) ?? 1) - 1;
  if (n > 0) {
    refs.set(id, n);
    return;
  }
  refs.delete(id);
  setEntry(id, null);
  if (inTauri) bridge.unsubscribeGroup(id).catch(() => undefined);
}

export interface GroupResult<T> {
  /** Last data read (kept while a later read errors). `null` until the first read. */
  data: T | null;
  error: string | null;
  status: GroupStatus;
}

/**
 * Subscribes to a detail group while the calling component is mounted. Pass `null` to
 * subscribe to nothing. `T` is the group's data type (declared by the phase that adds it).
 */
export function useGroup<T>(id: string | null): GroupResult<T> {
  useEffect(() => {
    if (!id) return;
    acquire(id);
    return () => release(id);
  }, [id]);
  const entry = useGroupStore((s) => (id ? s.entries[id] : undefined));
  return {
    data: (entry?.data ?? null) as T | null,
    error: entry?.error ?? null,
    status: entry?.status ?? "loading",
  };
}
