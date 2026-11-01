/**
 * App sessions: which apps play into each virtual input / record from each
 * B bus. State arrives on `sessions://state` (only on change); per-app peaks stream ~15/s into
 * `appLevels`, outside React (like `levelsStore`).
 *
 * Volume/mute edits are optimistic: the value shows at once, writes are throttled per app, and
 * incoming state for that app is ignored for `ECHO_MS` after the last edit so it can't jump back.
 */
import { create } from "zustand";
import {
  bridge,
  errorMessage,
  inTauri,
  sessionsEvents,
  type AppLevels,
  type EndpointApps,
  type SessionTarget,
  type SessionsState,
} from "@/lib/bridge";
import { keyedThrottle } from "@/lib/throttle";
import { toast } from "@/components/ui";
import { ECHO_MS, WRITE_MS } from "./mixerStore";

type Status = "idle" | "loading" | "ready" | "error";

interface Pending {
  volume?: number;
  muted?: boolean;
  until: number;
}

interface SessionsStore {
  /** Backend state with pending local edits applied. `null` until loaded. */
  state: SessionsState | null;
  /** As last received from Rust. */
  raw: SessionsState | null;
  /** Bridge status (not Windows audio; see `state.status` for that). */
  status: Status;
  error: string | null;
  pending: Record<string, Pending>;
  init: () => Promise<void>;
  /** Scan now; also retries Windows audio after a failure. Rejects with a readable message. */
  rescan: () => Promise<void>;
  setAppVolume: (key: string, volume: number) => void;
  setAppMute: (key: string, muted: boolean) => Promise<void>;
}

function overlay(raw: SessionsState | null, pending: Record<string, Pending>): SessionsState | null {
  if (!raw) return null;
  const now = performance.now();
  const live = Object.entries(pending).filter(([, p]) => p.until > now);
  if (live.length === 0) return raw;
  const edits = new Map(live);
  return {
    ...raw,
    endpoints: raw.endpoints.map((ep) =>
      ep.apps.some((a) => edits.has(a.key))
        ? {
            ...ep,
            apps: ep.apps.map((a) => {
              const p = edits.get(a.key);
              return p ? { ...a, volume: p.volume ?? a.volume, muted: p.muted ?? a.muted } : a;
            }),
          }
        : ep,
    ),
  };
}

function prune(pending: Record<string, Pending>): Record<string, Pending> {
  const now = performance.now();
  const next: Record<string, Pending> = {};
  for (const [k, p] of Object.entries(pending)) if (p.until > now) next[k] = p;
  return next;
}

let initPromise: Promise<void> | null = null;

export const useSessionsStore = create<SessionsStore>((set, get) => {
  const apply = (raw: SessionsState | null, pending = prune(get().pending)) =>
    set({ raw, pending, state: overlay(raw, pending) });

  const edit = (key: string, patch: Omit<Pending, "until">) => {
    const prev = get().pending[key];
    const pending = { ...prune(get().pending), [key]: { ...prev, ...patch, until: performance.now() + ECHO_MS } };
    apply(get().raw, pending);
    // Re-apply once the echo window ends, so a dropped write shows the real value again.
    setTimeout(() => apply(get().raw), ECHO_MS + 20);
  };

  const revert = (key: string, err: unknown) => {
    const pending = { ...get().pending };
    delete pending[key];
    apply(get().raw, pending);
    toast.error(errorMessage(err));
  };

  const writeVolume = keyedThrottle<number>((key, v) => {
    bridge.setAppVolume(key, v).catch((err: unknown) => revert(key, err));
  }, WRITE_MS);

  return {
    state: null,
    raw: null,
    status: "idle",
    error: null,
    pending: {},
    init: () => {
      if (!inTauri) return Promise.resolve();
      if (initPromise) return initPromise;
      set({ status: "loading", error: null });
      initPromise = (async () => {
        try {
          await sessionsEvents.onState((s) => {
            if (s.rev >= (get().raw?.rev ?? 0)) apply(s);
          });
          const s = await bridge.getSessions();
          if (s.rev >= (get().raw?.rev ?? 0)) apply(s);
          set({ status: "ready" });
          await appLevels.start();
        } catch (err) {
          initPromise = null;
          set({ status: "error", error: errorMessage(err) });
        }
      })();
      return initPromise;
    },
    rescan: async () => {
      await bridge.rescanSessions();
    },
    setAppVolume: (key, volume) => {
      const v = Math.min(1, Math.max(0, volume));
      edit(key, { volume: v });
      writeVolume(key, v);
    },
    setAppMute: async (key, muted) => {
      edit(key, { muted });
      try {
        await bridge.setAppMute(key, muted);
      } catch (err) {
        revert(key, err);
      }
    },
  };
});

function sameTarget(a: SessionTarget, b: SessionTarget): boolean {
  return a.kind === b.kind && a.index === b.index;
}

/** The apps on one virtual strip (`{kind: "strip", index: 5..7}`) or B bus (`{kind: "bus", index: 5..7}`). */
export function useSessions(target: SessionTarget): EndpointApps | undefined {
  return useSessionsStore((s) => s.state?.endpoints.find((e) => sameTarget(e.target, target)));
}

// ---- Per-app peaks, non-reactive (read them in requestAnimationFrame). ----

const peaks = new Map<string, number>();
let peakFrame = 0;
let peakAt = 0;
let levelsStarted: Promise<void> | null = null;

function writePeaks(l: AppLevels) {
  peaks.clear();
  for (const [k, v] of l.peaks) peaks.set(k, v);
  peakFrame++;
  peakAt = performance.now();
}

export const appLevels = {
  /** Linear peak 0..1 of one app (0 when unknown, silent, or older than half a second). */
  get(key: string): number {
    if (performance.now() - peakAt > 500) return 0;
    return peaks.get(key) ?? 0;
  },
  /** Increments per received frame. */
  frame: () => peakFrame,
  /** Opens the peak stream. Idempotent; `initSessions()` calls it. */
  start(): Promise<void> {
    if (!inTauri) return Promise.resolve();
    if (!levelsStarted) {
      levelsStarted = bridge.startAppLevels(writePeaks).catch((err: unknown) => {
        levelsStarted = null;
        throw err;
      });
    }
    return levelsStarted;
  },
};

/** Called once from `main.tsx`. */
export function initSessions(): void {
  void useSessionsStore.getState().init();
}
