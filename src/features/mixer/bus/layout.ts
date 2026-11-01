/**
 * Master v2 geometry. Eight horizontal bus rows in two sub-groups
 * that flex between `ROW.min` and `ROW.max`; each row picks a density from its own height.
 */
import { faderInset, VALUE_CAP_H } from "@/components/mixer";

/** The Master column width (`--master-w`, `clamp(360px, 27vw, 440px)`). Use as a CSS width. */
export const MASTER_WIDTH = "var(--master-w)";

/** Row height clamp and the gap between rows. */
export const ROW = { min: 68, max: 104, gap: 4 } as const;

/** Sub-group header ("Physical · A1–A5"): 16px label + 4px below; 10px between the two groups. */
export const SUBGROUP = { header: 16, headerGap: 4, spacing: 10 } as const;

/** 2×2 button block (Mute · Mono / EQ · Sel). Spec minimum 44×26. */
export const BUS_BUTTON = { w: 44, h: 26, hComfy: 28, gap: 4 } as const;

/** Line 1 (badge, label, device/apps, mode, ⋯) height. */
export const LINE1 = 22;
/** Horizontal meter under the rail: 2 bars × 3px, 2px apart. */
export const METER = { barWidth: 3, barGap: 2 } as const;
export const METER_H = 2 * METER.barWidth + METER.barGap;
/** `inset` for the row's `<Meter>` so it lines up with the value-in-cap fader. */
export const ROW_FADER_INSET = faderInset({ orientation: "horizontal", valueInCap: true });

/** Fader block height (rail · [scale] · meter, 4px apart) per scale style. */
const faderBlock = (scale: 0 | 6 | 14) => VALUE_CAP_H.h + (scale ? scale + 4 : 0) + 4 + METER_H;

export type RowDensity = "compact" | "ticks" | "labels";

/**
 * Vertical padding (the same at every density, so measuring the content box can't flip the
 * density back and forth) and the gap between line 1 and the fader per density.
 */
export const ROW_PAD_Y = 4;
export const LINE_GAP: Readonly<Record<RowDensity, number>> = { compact: 2, ticks: 4, labels: 4 };

/** Smallest row height (borders included) that fits each density. */
export const DENSITY_MIN_H: Readonly<Record<RowDensity, number>> = {
  compact: 2 + 2 * ROW_PAD_Y + LINE1 + LINE_GAP.compact + faderBlock(0), // 68
  ticks: 2 + 2 * ROW_PAD_Y + LINE1 + LINE_GAP.ticks + faderBlock(6), // 80
  labels: 2 + 2 * ROW_PAD_Y + LINE1 + LINE_GAP.labels + faderBlock(14), // 88
};

/** Compact = no scale (68–79px), ticks (80–87px), labelled scale (≥ 88px). */
export function rowDensity(height: number): RowDensity {
  if (height >= DENSITY_MIN_H.labels) return "labels";
  if (height >= DENSITY_MIN_H.ticks) return "ticks";
  return "compact";
}

/**
 * Flex for a sub-group of `n` rows: the basis holds the header and the row gaps, so the free
 * space splits by row count and every row on the column ends up the same height.
 */
export function subgroupStyle(n: number): { flex: string; minHeight: number; maxHeight: number } {
  const fixed = SUBGROUP.header + SUBGROUP.headerGap + (n - 1) * ROW.gap;
  return { flex: `${n} 1 ${fixed}px`, minHeight: fixed + n * ROW.min, maxHeight: fixed + n * ROW.max };
}
