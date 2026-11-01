/**
 * Mixer keyboard model. Not global hotkeys: these act only while
 * focus is on the Mixer board (or nowhere in particular, i.e. `body`, while the Mixer is shown).
 *
 *   1–8          focus input strip N           Shift+1–8   focus bus N (A1…B3)
 *   inside a focused strip or bus:
 *   M mute · S solo (strips) · ↑/↓ gain ±0.5 dB (Shift ±0.1) · 0 unity · F open FX / EQ
 *
 * A key a focused control already handles (the fader's arrows, a menu trigger's ArrowDown) is
 * left alone (`defaultPrevented`), and nothing fires while typing in a text field.
 */
import { useEffect, type RefObject } from "react";
import { create } from "zustand";
import { GAIN_MAX, GAIN_MIN, roundDb } from "@/lib/db";
import { BUSES, STRIPS, bus as busParams, strip as stripParams } from "@/lib/params";
import { useMixer } from "@/stores/mixerStore";
import { getMixerActions } from "./extensions";

export type StripFocusTarget = { kind: "strip" | "bus"; index: number };

/** One row of the keymap, shown in Settings › Hotkeys. */
export interface MixerKey {
  keys: readonly (readonly string[])[];
  /** Shown between key combos: a range ("1 to 8") or alternatives ("↑ / ↓"). */
  sep?: "to" | "/";
  action: string;
}

export const MIXER_KEYMAP: readonly MixerKey[] = [
  { keys: [["1"], ["8"]], sep: "to", action: "Focus input strip 1–8" },
  {
    keys: [
      ["Shift", "1"],
      ["Shift", "8"],
    ],
    sep: "to",
    action: "Focus bus A1–B3",
  },
  { keys: [["M"]], action: "Mute the focused strip or bus" },
  { keys: [["S"]], action: "Solo the focused strip" },
  { keys: [["↑"], ["↓"]], sep: "/", action: "Gain ±0.5 dB (hold Shift for ±0.1 dB)" },
  { keys: [["0"]], action: "Gain to 0.0 dB" },
  { keys: [["F"]], action: "Open effects (strip) or the EQ editor (bus)" },
];

const GAIN_STEP = 0.5;
const GAIN_FINE = 0.1;

interface FocusStore {
  focused: StripFocusTarget | null;
  board: HTMLElement | null;
}

const useFocusStore = create<FocusStore>(() => ({ focused: null, board: null }));

const selector = (t: StripFocusTarget) => (t.kind === "strip" ? `[data-strip="${t.index}"]` : `[data-bus="${t.index}"]`);

/** Moves focus to a strip card (or its collapsed rail) or a bus row. Returns false if it isn't on screen. */
function focusTarget(t: StripFocusTarget): boolean {
  const board = useFocusStore.getState().board;
  const el = board?.querySelector<HTMLElement>(selector(t));
  if (!el) return false;
  // A collapsed rail is a button inside the wrapper; a card or row takes focus itself (tabIndex -1).
  const focusable = el.hasAttribute("data-collapsed") ? el.querySelector<HTMLElement>("button") : el;
  focusable?.focus();
  focusable?.scrollIntoView({ block: "nearest", inline: "nearest" });
  return true;
}

/**
 * Which strip or bus currently holds focus (any control inside it counts), plus helpers to move
 * focus programmatically. Usable from any component; focus moves only while the Mixer is mounted.
 */
export function useStripFocus() {
  const focused = useFocusStore((s) => s.focused);
  return {
    focused,
    focusStrip: (i: number) => focusTarget({ kind: "strip", index: i }),
    focusBus: (j: number) => focusTarget({ kind: "bus", index: j }),
  };
}

function targetOf(el: Element | null): StripFocusTarget | null {
  const host = el?.closest<HTMLElement>("[data-strip],[data-bus]");
  if (!host) return null;
  const s = host.dataset.strip;
  if (s !== undefined) return { kind: "strip", index: Number(s) };
  return { kind: "bus", index: Number(host.dataset.bus) };
}

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return !["checkbox", "radio", "button", "range"].includes(el.type);
  return false;
}

/**
 * Digit1–Digit8 / Numpad1–Numpad8 → 0–7. Physical codes keep Shift+digit layout-independent;
 * an unshifted "1"–"8" with no code (remote desktop, injected input) falls back to the key.
 */
function digitIndex(e: KeyboardEvent): number | null {
  const m = /^(?:Digit|Numpad)([1-8])$/.exec(e.code);
  if (m) return Number(m[1]) - 1;
  if (!e.code && /^[1-8]$/.test(e.key)) return Number(e.key) - 1;
  return null;
}

const clampGain = (v: number) => roundDb(Math.min(GAIN_MAX, Math.max(GAIN_MIN, v)));

/** Runs the in-strip action for `key`; returns true if it handled it. */
function act(t: StripFocusTarget, e: KeyboardEvent): boolean {
  const state = useMixer.getState();
  const s = state.state;
  if (!s) return false;
  const set = state.setParam;
  const actions = getMixerActions();
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  if (t.kind === "strip") {
    const strip = s.strips[t.index];
    if (!strip) return false;
    const p = stripParams(t.index);
    switch (key) {
      case "m":
        void set(p.mute(), strip.mute ? 0 : 1);
        return true;
      case "s":
        void set(p.solo(), strip.solo ? 0 : 1);
        return true;
      case "ArrowUp":
      case "ArrowDown":
        void set(p.gain(), clampGain(strip.gain + (key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? GAIN_FINE : GAIN_STEP)));
        return true;
      case "0":
        void set(p.gain(), 0);
        return true;
      case "f":
        if (!actions.openStripFx) return false;
        actions.openStripFx(t.index, strip.kind === "virtual" ? "eq" : undefined);
        return true;
    }
    return false;
  }

  const b = s.buses[t.index];
  if (!b) return false;
  const p = busParams(t.index);
  switch (key) {
    case "m":
      void set(p.mute(), b.mute ? 0 : 1);
      return true;
    case "ArrowUp":
    case "ArrowDown":
      void set(p.gain(), clampGain(b.gain + (key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? GAIN_FINE : GAIN_STEP)));
      return true;
    case "0":
      void set(p.gain(), 0);
      return true;
    case "f":
      if (!actions.openBusEq) return false;
      actions.openBusEq(t.index);
      return true;
  }
  return false;
}

/**
 * Installs the keyboard model on the Mixer board element. Call once from the board component;
 * `mounted` = the board element is rendered (re-runs the effect when it appears).
 */
export function useMixerKeyboard(board: RefObject<HTMLElement | null>, mounted: boolean): void {
  useEffect(() => {
    const el = board.current;
    if (!el) return;
    useFocusStore.setState({ board: el });

    const onFocusIn = (e: FocusEvent) => useFocusStore.setState({ focused: targetOf(e.target as Element) });
    const onFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Element | null;
      if (!next || !el.contains(next)) useFocusStore.setState({ focused: null });
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
      const target = e.target as Element | null;
      const onBoard = !!target && el.contains(target);
      // Focus on nothing in particular (body) or on a container around the board also counts.
      const around = !!target && !onBoard && target.contains(el);
      if (!onBoard && !around) return;
      if (isTyping(target)) return;

      const n = digitIndex(e);
      if (n !== null) {
        if (e.repeat) return;
        const ok = e.shiftKey
          ? n < BUSES && focusTarget({ kind: "bus", index: n })
          : n < STRIPS && focusTarget({ kind: "strip", index: n });
        if (ok) e.preventDefault();
        return;
      }
      const t = onBoard ? targetOf(target) : null;
      if (!t) return;
      if (e.repeat && !(e.key === "ArrowUp" || e.key === "ArrowDown")) return;
      if (act(t, e)) e.preventDefault();
    };

    el.addEventListener("focusin", onFocusIn);
    el.addEventListener("focusout", onFocusOut);
    // Bubble phase on window: controls inside the board get first say and can preventDefault.
    window.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("focusin", onFocusIn);
      el.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("keydown", onKey);
      useFocusStore.setState({ board: null, focused: null });
    };
  }, [board, mounted]);
}
