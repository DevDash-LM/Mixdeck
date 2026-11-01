/** The Mixer's "Effects…" items and quick-knob right-clicks open the Strip FX drawer. */
import { registerMixerActions, registerMixerOverlay } from "@/features/mixer/extensions";
import StripFxDrawer from "./StripFxDrawer";
import { useStripFx } from "./stripFxStore";

registerMixerActions({ openStripFx: (i, tab) => useStripFx.getState().openFx(i, tab) });
registerMixerOverlay({ id: "strip-fx", component: StripFxDrawer });
