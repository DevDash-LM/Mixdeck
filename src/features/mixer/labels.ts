/** Display names on the Mixer page. Parameter names live in `@/lib/params`, not here. */
import type { BusMode } from "@/lib/bridge";
import { BUS_NAMES, STRIP_DEFAULT_NAMES } from "@/lib/params";

/** Bus mode names as Voicemeeter's mode menu shows them, plus a short chip label. */
export const BUS_MODE_LABEL: Readonly<Record<BusMode, { full: string; short: string }>> = {
  normal: { full: "Normal", short: "Normal" },
  amix: { full: "Mix down A", short: "Mix A" },
  bmix: { full: "Mix down B", short: "Mix B" },
  repeat: { full: "Stereo repeat", short: "Repeat" },
  composite: { full: "Composite", short: "Compos." },
  tvMix: { full: "TV mix", short: "TV mix" },
  upMix21: { full: "Up mix 2.1", short: "Up 2.1" },
  upMix41: { full: "Up mix 4.1", short: "Up 4.1" },
  upMix61: { full: "Up mix 6.1", short: "Up 6.1" },
  centerOnly: { full: "Center only", short: "Center" },
  lfeOnly: { full: "LFE only", short: "LFE" },
  rearOnly: { full: "Rear only", short: "Rear" },
};

/** Grouping in the mode menu (separators between groups). */
export const BUS_MODE_GROUPS: readonly (readonly BusMode[])[] = [
  ["normal", "amix", "bmix", "repeat", "composite", "tvMix"],
  ["upMix21", "upMix41", "upMix61"],
  ["centerOnly", "lfeOnly", "rearOnly"],
];

/**
 * Captions for the virtual-strip `EQGain1..3` knobs. The cheatsheet doesn't name the bands:
 * confirm against Voicemeeter's virtual strip and rename here (e.g. Bass/Mid/Treble).
 */
export const VIRTUAL_EQ_CAPTIONS = ["EQ 1", "EQ 2", "EQ 3"] as const;
/** Tooltips for the virtual EQ knobs until the band names are confirmed. */
export const VIRTUAL_EQ_HINT = "Voicemeeter's 3-band EQ (EQGain1–3). Band names are not confirmed yet.";

/** HW strip knob captions: full, and the short form below 136px. */
export const HW_KNOB_CAPTIONS = [
  { full: "Comp", short: "Comp", label: "compressor" },
  { full: "Gate", short: "Gate", label: "gate" },
  { full: "Denoise", short: "Den", label: "denoiser" },
] as const;

/** Compact default names for the strip header (the full default is in the tooltip). */
const STRIP_SHORT_NAMES = ["Input 1", "Input 2", "Input 3", "Input 4", "Input 5", "Virtual", "AUX", "VAIO3"] as const;

/** Voicemeeter's default name for strip `i` ("Hardware Input 1"). */
export const stripDefaultName = (i: number) => STRIP_DEFAULT_NAMES[i] ?? `Strip ${i + 1}`;
/** The strip's label, or its compact default name. */
export const stripName = (i: number, label: string) => label.trim() || STRIP_SHORT_NAMES[i] || stripDefaultName(i);
export const busName = (j: number) => BUS_NAMES[j] ?? `Bus ${j + 1}`;
export const busTitle = (j: number, label: string) => label.trim() || busName(j);

export const MONO_LABEL = ["Off", "Mono", "Stereo reverse"] as const;
