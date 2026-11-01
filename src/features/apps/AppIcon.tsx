/**
 * App icon: the session's PNG data URL, or a monogram tile when there's none
 * (or it fails to decode). App icons are the only full-colour images in the UI; Settings ›
 * Apps can draw them in greyscale.
 */
import { useState } from "react";
import type { AppSession } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { useAppsSettings } from "./useApps";

export interface AppIconProps {
  app: Pick<AppSession, "name" | "icon">;
  /** Square size in px. */
  size: number;
  className?: string;
}

function monogram(name: string): string {
  const ch = name.trim().match(/[\p{L}\p{N}]/u)?.[0];
  return (ch ?? "?").toUpperCase();
}

export function AppIcon({ app, size, className }: AppIconProps) {
  const { monochromeIcons } = useAppsSettings();
  const [broken, setBroken] = useState<string | null>(null);
  const src = app.icon && app.icon !== broken ? app.icon : null;

  if (src) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden
        draggable={false}
        width={size}
        height={size}
        onError={() => setBroken(src)}
        className={cn("shrink-0 object-contain select-none", monochromeIcons && "grayscale", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[4px] border border-line bg-panel-2 font-medium text-text-dim select-none",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5), lineHeight: 1 }}
    >
      {monogram(app.name)}
    </span>
  );
}
