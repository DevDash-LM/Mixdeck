/**
 * Input strip v2 geometry. Every input strip is a grid of five zones with the
 * same fixed heights, so zone borders form continuous lines across the board.
 */

/** Zone heights in px. `fader` is the flexible zone's minimum. */
export const STRIP_ZONES = {
  header: 40,
  source: 64,
  knobs: 78,
  /** Spec says ≥ 200; 8 route buttons at 22px + gaps + 2×10 padding need 226. */
  fader: 230,
  footer: 72,
} as const;

/** `grid-template-rows` for the strip card. */
export const STRIP_ROWS = `${STRIP_ZONES.header}px ${STRIP_ZONES.source}px ${STRIP_ZONES.knobs}px minmax(${STRIP_ZONES.fader}px, 1fr) ${STRIP_ZONES.footer}px`;

/**
 * Virtual strips with an Apps zone: Apps takes the flex space and the fader
 * zone is fixed at its minimum, so it's visibly shorter than the HW faders (by design).
 */
export const virtualStripRows = (fader: number = STRIP_ZONES.fader) =>
  `${STRIP_ZONES.header}px ${STRIP_ZONES.source}px ${STRIP_ZONES.knobs}px minmax(0, 1fr) ${fader}px ${STRIP_ZONES.footer}px`;
export const VIRTUAL_STRIP_ROWS = virtualStripRows();

/** One app row in the Apps zone (icon/name/mute line + volume slider). Rows are 4px apart. */
export const APPS_ROW = 44;

/**
 * Smallest Apps zone the fader splitter may leave: three full app rows (+2 gaps, 4px list
 * padding top and bottom, the 20px "Windows mixer" link and the zone's 1px border).
 */
export const APPS_MIN_H = 3 * APPS_ROW + 2 * 4 + 8 + 20 + 1;

/** Fixed zones of a virtual strip around the two flexible ones (Apps, Fader). */
export const STRIP_FIXED_H = STRIP_ZONES.header + STRIP_ZONES.source + STRIP_ZONES.knobs + STRIP_ZONES.footer;

/** Narrowest a resized Master column may get. */
export const MASTER_MIN = 320;

/** Width clamp (`--strip-min` / `--strip-max`) and the board's gaps. */
export const STRIP_MIN = 108;
export const STRIP_MAX = 168;
export const STRIP_GAP = 6;
/** Between the hardware and virtual groups (1px `line` rule centred). */
export const GROUP_GAP = 16;
/** Between the inputs and Master (1px `line-strong` rule centred). */
export const MASTER_GAP = 24;
export const BOARD_PAD = 12;
/** SectionHeader (28) + gap below (8). */
export const HEADER_BLOCK = 36;

/** Card height at the smallest fader zone, borders included. */
export const STRIP_MIN_HEIGHT =
  STRIP_ZONES.header + STRIP_ZONES.source + STRIP_ZONES.knobs + STRIP_ZONES.fader + STRIP_ZONES.footer + 4 + 2;

/** Width of a group of `n` strips at the min / max strip width. */
export const groupWidth = (n: number, strip: number) => n * strip + (n - 1) * STRIP_GAP;

/** A collapsed strip: a fixed 36px rail. */
export const RAIL_WIDTH = 36;

/** Width of a group with `open` full strips at `strip` px and `rails` collapsed rails. */
export const mixedGroupWidth = (open: number, rails: number, strip: number) =>
  open * strip + rails * RAIL_WIDTH + Math.max(0, open + rails - 1) * STRIP_GAP;

/** Density breakpoints (strip card width in px). */
export const DENSITY = {
  /** Numeric scale labels left of the fader (ticks only below). */
  scaleLabels: 138,
  /** Knobs drop from 36 to 34 below this. */
  fullKnob: 120,
  /** "Denoise" instead of "Den" from this width (CSS container query `@[136px]`). */
  fullCaptions: 136,
} as const;

/** Route column: 36px wide, 22–34px tall buttons; 4px between, 6px between A and B. */
export const ROUTE = { width: 36, minH: 22, maxH: 34, gap: 4, groupGap: 6 } as const;
