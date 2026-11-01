/**
 * Slot: illustration for empty states (Presets, device list, hotkeys).
 * Props: { variant: 'presets' | 'devices' | 'hotkeys' }.
 * Default: a 1px-stroke lucide icon in a 48px `line`-bordered square.
 */
import { Bookmark, Keyboard, Speaker } from "lucide-react";

export interface EmptyIllustrationProps {
  variant: "presets" | "devices" | "hotkeys";
}

const icons = { presets: Bookmark, devices: Speaker, hotkeys: Keyboard } as const;

export default function EmptyIllustration({ variant }: EmptyIllustrationProps) {
  const Icon = icons[variant];
  return (
    <div aria-hidden className="flex size-12 items-center justify-center rounded-lg border border-line text-text-dim">
      <Icon size={20} strokeWidth={1} />
    </div>
  );
}
