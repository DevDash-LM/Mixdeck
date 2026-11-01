import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge our custom scales so `text-12` (size) and `text-text-dim`
// (colour) aren't treated as conflicting classes.
const twMerge = extendTailwindMerge({
  override: {
    theme: {
      color: [
        "bg", "panel", "panel-2", "line", "line-strong", "text", "text-dim", "text-faint",
        "fg", "fg-ink", "mute", "solo", "meter-lo", "meter-mid", "meter-hi", "meter-off", "black",
      ],
      text: ["11", "12", "13", "14", "16"],
      radius: ["sm", "md", "lg"],
      shadow: ["overlay"],
      font: ["sans", "mono"],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
