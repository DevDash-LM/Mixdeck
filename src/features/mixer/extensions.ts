/**
 * Mixer extension points. Features plug into the Mixer page by adding a
 * file and ONE registration call here at module load, never by editing the cards:
 *
 *   registerMixerActions({ openStripFx: (i, tab) => useStripFx.getState().open(i, tab) });
 *   registerMixerOverlay({ id: "strip-fx", component: StripFxDrawer });
 *   registerDevicePicker("strip", StripDevicePicker);
 *   registerStripSource("virtual", EndpointCard);
 *   registerStripApps("virtual", StripApps);
 *   registerBusSource("virtual", ListeningApps);
 *
 * Until a handler is registered, the matching menu item / chip is shown disabled with a
 * "Coming soon" hint (no dead ends). Like the view registry, this isn't reactive: register
 * before the Mixer first renders (i.e. at import time).
 */
import type { ComponentType } from "react";

export type StripFxTab = "eq" | "comp" | "gate";

export interface MixerActions {
  /** Open the Strip FX drawer for strip `i` (optionally on a tab). */
  openStripFx?: (i: number, tab?: StripFxTab) => void;
  /** Open the Routing view with strip `i` highlighted. */
  editRouting?: (i: number) => void;
  /** Open the Bus EQ editor for bus `j`. */
  openBusEq?: (j: number) => void;
  /** "Save preset" quick action. */
  savePreset?: () => void;
}

/**
 * Replaces the static device chip on a hardware strip (`index` 0–4) or physical bus (0–4).
 * `variant="card"` asks for the 50px Source-zone card instead of the chip;
 * a picker that ignores it still works, it just looks like a chip inside the card.
 */
export type DevicePicker = ComponentType<{ index: number; current: string | null; variant?: "chip" | "card" }>;

/** Fills the Source zone of a virtual input strip (`strip` 5–7). */
export type StripSource = ComponentType<{ strip: number }>;

/**
 * Fills the Apps zone of a virtual input strip (`strip` 5–7), between Knobs and a 230px fader.
 * Returning `null` (e.g. apps turned off in Settings) puts the strip back on the 5-zone layout
 * with a full-height fader.
 */
export type StripApps = ComponentType<{ strip: number }>;

/** Fills line 1 of a virtual bus row (`bus` 5–7) where A buses show the device chip. */
export type BusSource = ComponentType<{ bus: number }>;

export interface MixerOverlayDef {
  id: string;
  /** Rendered inside the Mixer page, above the board (drawers, popovers). */
  component: ComponentType;
}

const actions: MixerActions = {};
const pickers: { strip?: DevicePicker; bus?: DevicePicker } = {};
const overlays = new Map<string, MixerOverlayDef>();
const stripSources: { virtual?: StripSource } = {};
const busSources: { virtual?: BusSource } = {};
const stripApps: { virtual?: StripApps } = {};

export function registerMixerActions(partial: MixerActions): void {
  Object.assign(actions, partial);
}

export function registerDevicePicker(kind: "strip" | "bus", component: DevicePicker): void {
  pickers[kind] = component;
}

/** Until something registers, the virtual Source card shows "Desktop audio" + "Apps appear here". */
export function registerStripSource(kind: "virtual", component: StripSource): void {
  stripSources[kind] = component;
}

/** Until something registers, virtual strips keep the 5-zone layout (no Apps zone). */
export function registerStripApps(kind: "virtual", component: StripApps): void {
  stripApps[kind] = component;
}

/** Until something registers, B bus rows show a quiet "Virtual" note. */
export function registerBusSource(kind: "virtual", component: BusSource): void {
  busSources[kind] = component;
}

export function registerMixerOverlay(def: MixerOverlayDef): void {
  overlays.set(def.id, def);
}

export const getMixerActions = (): Readonly<MixerActions> => actions;
export const getDevicePicker = (kind: "strip" | "bus"): DevicePicker | undefined => pickers[kind];
export const listMixerOverlays = (): MixerOverlayDef[] => [...overlays.values()];
export const getStripSource = (kind: "virtual"): StripSource | undefined => stripSources[kind];
export const getStripApps = (kind: "virtual"): StripApps | undefined => stripApps[kind];
export const getBusSource = (kind: "virtual"): BusSource | undefined => busSources[kind];
