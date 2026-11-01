/** Decibel helpers. Levels from the engine are linear amplitude (1.0 = 0 dBFS). */

/** Meter floor. */
export const DB_FLOOR = -60;
/** Fader range (Strip/Bus Gain). */
export const GAIN_MIN = -60;
export const GAIN_MAX = 12;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Linear amplitude → dB, clamped to `floor`. */
export function linearToDb(v: number, floor = DB_FLOOR): number {
  if (!(v > 0)) return floor;
  return Math.max(floor, 20 * Math.log10(v));
}

/** dB → linear amplitude (at or below the floor → 0). */
export function dbToLinear(db: number, floor = DB_FLOOR): number {
  return db <= floor ? 0 : Math.pow(10, db / 20);
}

/** dB → 0..1 position on a meter whose scale runs from `floor` to `top` dB. */
export function dbToMeter(db: number, floor = DB_FLOOR, top = 0): number {
  return clamp((db - floor) / (top - floor), 0, 1);
}

/** Rounds to 0.1 dB, the precision Mixdeck shows and writes for faders. */
export const roundDb = (db: number) => Math.round(db * 10) / 10;

/** "-6.0", "+3.5", "-inf" at the floor. Uses a real minus sign for display. */
export function formatDb(db: number, floor = GAIN_MIN): string {
  if (db <= floor) return "-∞";
  const r = roundDb(db);
  const s = Math.abs(r).toFixed(1);
  if (r > 0) return `+${s}`;
  if (r < 0) return `−${s}`;
  return s;
}

/**
 * A fader is "boosted" when its *set* gain rounds (to 0.1 dB) above 0.0.
 * Exactly +0.0 (and anything that rounds to it, e.g. 0.04) is unity, not boost.
 */
export const boostState = (db: number): boolean => roundDb(db) > 0;

/**
 * Value-in-cap text: always signed for boost, real minus sign, "−∞" at the floor.
 * "−6.0", "0.0", "+3.5". (Like `formatDb`, but the floor uses a real minus too.)
 */
export function formatSignedDb(db: number, floor = GAIN_MIN): string {
  if (db <= floor) return "−∞";
  return formatDb(db, floor);
}
