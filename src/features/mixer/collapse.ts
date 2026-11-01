/**
 * Collapsed input strips, persisted as `Settings.collapsedStrips`.
 */
import { useEffect } from "react";
import { toast } from "@/components/ui";
import { inTauri } from "@/lib/bridge";
import { useSettings } from "@/stores/settingsStore";

const NONE: readonly number[] = [];

/** Collapsed strip indices, loading Settings once if nothing has yet. */
export function useCollapsedStrips(): readonly number[] {
  const status = useSettings((s) => s.status);
  const list = useSettings((s) => s.settings?.collapsedStrips);
  useEffect(() => {
    if (status === "idle" && inTauri) void useSettings.getState().load();
  }, [status]);
  return list ?? NONE;
}

/** True once Settings has an answer (or can't get one), so the board can render without a shift. */
export function useSettingsSettled(): boolean {
  const status = useSettings((s) => s.status);
  return !inTauri || status === "ready" || status === "error";
}

/** Collapses or expands strip `i` (optimistic; reverts with a toast on failure). */
export function setStripCollapsed(i: number, collapsed: boolean): void {
  const { settings, update } = useSettings.getState();
  const cur = settings?.collapsedStrips ?? [];
  const next = collapsed ? [...new Set([...cur, i])].sort((a, b) => a - b) : cur.filter((k) => k !== i);
  update({ collapsedStrips: next }).catch((err: unknown) =>
    toast.error(collapsed ? "Couldn't collapse the strip" : "Couldn't expand the strip", {
      description: err instanceof Error ? err.message : undefined,
    }),
  );
}
