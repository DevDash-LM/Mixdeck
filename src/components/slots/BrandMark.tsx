/**
 * Slot: title-bar logo + About screen.
 * Props: { size: 16 | 24 | 64 }. Replace this file to swap in a custom mark.
 * Default: the monochrome app icon (assets/icon.svg).
 */
import iconUrl from "../../../assets/icon.svg";

export interface BrandMarkProps {
  size: 16 | 24 | 64;
}

export default function BrandMark({ size }: BrandMarkProps) {
  return <img src={iconUrl} width={size} height={size} alt="" aria-hidden draggable={false} className="shrink-0" />;
}
