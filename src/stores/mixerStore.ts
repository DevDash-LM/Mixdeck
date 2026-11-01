/**
 * Mixer state from the engine (`mixer://state`, `mixer://connection`), with optimistic edits.
 *
 * `setParam(name, value)` shows the new value at once (`pending`), sends it throttled to ~30 Hz
 * with a trailing write, and ignores the engine's echoes of that param until ~300 ms after the
 * last local edit, so a fader never fights Voicemeeter. On failure the value reverts and a
 * toast explains why.
 */
import { create } from "zustand";
import { toast } from "@/components/ui";
import {
  bridge,
  engineEvents,
  errorMessage,
  inTauri,
  type BusMode,
  type ConnectionState,
  type MixerState,
  type ParamValue,
} from "@/lib/bridge";
import { BUS_MODES, BUSES, STRIPS, ScriptBuilder, bus, isHardwareStrip, strip } from "@/lib/params";
import { keyedThrottle } from "@/lib/throttle";
import { useGroupStore } from "./groupStore";
import { levelsStore } from "./levelsStore";

/** Echo-suppression window after the last local edit. */
export const ECHO_MS = 300;
/** Write throttle per param (~30 Hz). */
export const WRITE_MS = 33;

type Status = "idle" | "loading" | "ready" | "error";

export interface PendingEdit {
  value: ParamValue;
  until: number;
}

interface MixerStore {
  /** Backend state with pending local edits applied. `rev === 0` = nothing read yet. */
  state: MixerState | null;
  /** Last state exactly as the engine sent it. */
  raw: MixerState | null;
  connection: ConnectionState;
  /** Bridge status (loading the first snapshot), not the Voicemeeter connection. */
  status: Status;
  error: string | null;
  pending: Record<string, PendingEdit>;
  /** Subscribes to engine events and loads the first snapshot. Idempotent. */
  init: () => Promise<void>;
  /** Optimistic, throttled write. Errors revert and toast. */
  setParam: (name: string, value: ParamValue) => void;
  /** Atomic multi-param write (not optimistic). Rejects with a readable message. */
  setScript: (script: string) => Promise<void>;
  /**
   * Optimistic batched write: shows every value at once and sends them as one script
   * (split into atomic ≤ 48 kB chunks if needed). Errors revert, toast, and resolve `false`.
   */
  setParams: (edits: ReadonlyArray<readonly [name: string, value: ParamValue]>) => Promise<boolean>;
  /**
   * Shows values as pending (echo-suppressed for `ECHO_MS`) without writing them. For
   * callers that throttle their own `setParams` batches, so the UI never lags the pointer.
   */
  showPending: (edits: ReadonlyArray<readonly [name: string, value: ParamValue]>) => void;
}

// ---- Core param → state field (built from the params mirror, never hand-typed) ----

type Apply = (s: MixerState, v: ParamValue) => void;
const num = (v: ParamValue) => (typeof v === "number" ? v : Number(v));
const flag = (v: ParamValue) => num(v) >= 0.5;
const str = (v: ParamValue) => String(v);

const CORE_FIELDS: ReadonlyMap<string, Apply> = (() => {
  const m = new Map<string, Apply>();
  for (let i = 0; i < STRIPS; i++) {
    const p = strip(i);
    const at = (s: MixerState) => s.strips[i];
    m.set(p.gain(), (s, v) => { const t = at(s); if (t) t.gain = num(v); });
    m.set(p.mute(), (s, v) => { const t = at(s); if (t) t.mute = flag(v); });
    m.set(p.solo(), (s, v) => { const t = at(s); if (t) t.solo = flag(v); });
    m.set(p.label(), (s, v) => { const t = at(s); if (t) t.label = str(v); });
    for (let j = 0; j < BUSES; j++) {
      m.set(p.route(j), (s, v) => { const t = at(s); if (t) t.routes[j] = flag(v); });
    }
    if (isHardwareStrip(i)) {
      m.set(p.mono(), (s, v) => { const t = at(s); if (t) t.mono = flag(v); });
      const knob = (key: "comp" | "gate" | "denoiser"): Apply => (s, v) => {
        const q = at(s)?.quick;
        if (q?.kind === "hardware") q[key] = num(v);
      };
      m.set(p.comp(), knob("comp"));
      m.set(p.gate(), knob("gate"));
      m.set(p.denoiser(), knob("denoiser"));
    } else {
      m.set(p.mc(), (s, v) => { const t = at(s); if (t) t.mc = flag(v); });
      m.set(p.eqOn(), (s, v) => {
        const q = at(s)?.quick;
        if (q?.kind === "virtual") q.eqOn = flag(v);
      });
      ([1, 2, 3] as const).forEach((n) =>
        m.set(p.eqGain(n), (s, v) => {
          const q = at(s)?.quick;
          if (q?.kind === "virtual") q.eqGain[n - 1] = num(v);
        }),
      );
    }
  }
  for (let j = 0; j < BUSES; j++) {
    const p = bus(j);
    const at = (s: MixerState) => s.buses[j];
    m.set(p.gain(), (s, v) => { const t = at(s); if (t) t.gain = num(v); });
    m.set(p.mute(), (s, v) => { const t = at(s); if (t) t.mute = flag(v); });
    m.set(p.mono(), (s, v) => { const t = at(s); if (t) t.mono = Math.max(0, Math.min(2, Math.round(num(v)))); });
    m.set(p.sel(), (s, v) => { const t = at(s); if (t) t.sel = flag(v); });
    m.set(p.eqOn(), (s, v) => { const t = at(s); if (t) t.eqOn = flag(v); });
    m.set(p.label(), (s, v) => { const t = at(s); if (t) t.label = str(v); });
    BUS_MODES.forEach((mode: BusMode) =>
      m.set(p.mode(mode), (s, v) => { const t = at(s); if (t && flag(v)) t.mode = mode; }),
    );
  }
  return m;
})();

/** True when `name` is a Mixer-page (core) param that the optimistic overlay understands. */
export const isCoreParam = (name: string) => CORE_FIELDS.has(name);

function overlay(raw: MixerState | null, pending: Record<string, PendingEdit>): MixerState | null {
  if (!raw) return raw;
  const names = Object.keys(pending).filter((n) => CORE_FIELDS.has(n));
  if (names.length === 0) return raw;
  const next = structuredClone(raw);
  for (const n of names) {
    const edit = pending[n];
    if (edit) CORE_FIELDS.get(n)?.(next, edit.value);
  }
  return next;
}

function livePending(pending: Record<string, PendingEdit>, now: number) {
  const out: Record<string, PendingEdit> = {};
  for (const [k, v] of Object.entries(pending)) if (v.until > now) out[k] = v;
  return out;
}

let initPromise: Promise<void> | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;

export const useMixer = create<MixerStore>((set, get) => {
  /** Drops expired pending edits and re-derives `state`; re-arms itself for the next expiry. */
  const refresh = () => {
    const now = performance.now();
    const pending = livePending(get().pending, now);
    set({ pending, state: overlay(get().raw, pending) });
    if (expiryTimer) clearTimeout(expiryTimer);
    const next = Math.min(...Object.values(pending).map((p) => p.until));
    if (Number.isFinite(next)) expiryTimer = setTimeout(refresh, Math.max(0, next - now) + 5);
  };

  const send = keyedThrottle<ParamValue>((name, value) => {
    bridge.setParam(name, value).catch((err: unknown) => {
      const { [name]: _dropped, ...rest } = get().pending;
      set({ pending: rest });
      refresh();
      toast.error(errorMessage(err));
    });
  }, WRITE_MS);

  return {
    state: null,
    raw: null,
    connection: { status: "starting" },
    status: "idle",
    error: null,
    pending: {},

    init: () => {
      if (initPromise) return initPromise;
      if (!inTauri) {
        set({ status: "error", error: "Mixdeck's engine is only available in the desktop app." });
        initPromise = Promise.resolve();
        return initPromise;
      }
      set({ status: "loading", error: null });
      initPromise = (async () => {
        try {
          await engineEvents.onState((raw) => {
            set({ raw, connection: raw.connection });
            refresh();
          });
          await engineEvents.onConnection((connection) => {
            const raw = get().raw;
            set({ connection, raw: raw ? { ...raw, connection } : raw });
            refresh();
          });
          await useGroupStore.getState().init();
          const raw = await bridge.getState();
          // An event may have arrived while we waited; keep whichever is newer.
          const current = get().raw;
          if (!current || raw.rev >= current.rev) set({ raw, connection: raw.connection });
          set({ status: "ready" });
          refresh();
          await levelsStore.start();
        } catch (err) {
          initPromise = null;
          set({ status: "error", error: errorMessage(err) });
        }
      })();
      return initPromise;
    },

    setParam: (name, value) => {
      const pending = { ...get().pending, [name]: { value, until: performance.now() + ECHO_MS } };
      set({ pending });
      refresh();
      send(name, value);
    },

    setScript: async (script) => {
      try {
        await bridge.setScript(script);
      } catch (err) {
        throw new Error(errorMessage(err));
      }
    },

    showPending: (edits) => {
      if (edits.length === 0) return;
      const until = performance.now() + ECHO_MS;
      const pending = { ...get().pending };
      for (const [name, value] of edits) pending[name] = { value, until };
      set({ pending });
      refresh();
    },

    setParams: async (edits) => {
      if (edits.length === 0) return true;
      const until = performance.now() + ECHO_MS;
      const pending = { ...get().pending };
      const script = new ScriptBuilder();
      for (const [name, value] of edits) {
        pending[name] = { value, until };
        if (typeof value === "number") script.float(name, value);
        else script.string(name, value);
      }
      set({ pending });
      refresh();
      try {
        for (const chunk of script.chunks()) await bridge.setScript(chunk);
        return true;
      } catch (err) {
        const rest = { ...get().pending };
        for (const [name] of edits) delete rest[name];
        set({ pending: rest });
        refresh();
        toast.error(errorMessage(err));
        return false;
      }
    },
  };
});

/** Starts the engine bridge. Call once at startup. */
export function initEngine(): void {
  void useMixer.getState().init();
}

/** The current value of a param: the pending local edit while one is live, else `fallback`. */
export function usePendingValue<T extends ParamValue>(name: string, fallback: T): T {
  const edit = useMixer((s) => s.pending[name]);
  return edit ? (edit.value as T) : fallback;
}
