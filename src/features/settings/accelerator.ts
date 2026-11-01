/**
 * Accelerator strings for global hotkeys, in the `global-hotkey` crate's format
 * ("Control+Alt+Shift+Super+<KeyboardEvent.code>"). Built in a fixed modifier order so two
 * recordings of the same combination compare equal as strings.
 */

const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ShiftLeft",
  "ShiftRight",
  "MetaLeft",
  "MetaRight",
  "OSLeft",
  "OSRight",
]);

export type RecordResult =
  | { kind: "modifierOnly"; preview: string }
  | { kind: "done"; accelerator: string }
  | { kind: "cancel" }
  | { kind: "error"; message: string };

const isFunctionKey = (code: string) => /^F([1-9]|1\d|2[0-4])$/.test(code);

function modifiers(e: Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey">): string[] {
  const m: string[] = [];
  if (e.ctrlKey) m.push("Control");
  if (e.altKey) m.push("Alt");
  if (e.shiftKey) m.push("Shift");
  if (e.metaKey) m.push("Super");
  return m;
}

/** Interprets one keydown while recording. */
export function fromKeyEvent(e: KeyboardEvent): RecordResult {
  const mods = modifiers(e);
  if (MODIFIER_CODES.has(e.code) || e.code === "") {
    return { kind: "modifierOnly", preview: mods.map(modLabel).join("+") };
  }
  if (mods.length === 0 && e.code === "Escape") return { kind: "cancel" };
  if (mods.length === 0 && !isFunctionKey(e.code)) {
    return { kind: "error", message: "Add Ctrl, Alt, Shift or Win, so the shortcut doesn't block normal typing." };
  }
  return { kind: "done", accelerator: [...mods, e.code].join("+") };
}

function modLabel(m: string): string {
  return m === "Control" ? "Ctrl" : m === "Super" ? "Win" : m;
}

const KEY_LABELS: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  PageUp: "PgUp",
  PageDown: "PgDn",
  Delete: "Del",
  Insert: "Ins",
};

/** Display parts for an accelerator ("Control+Shift+KeyM" → ["Ctrl", "Shift", "M"]). */
export function acceleratorParts(accelerator: string): string[] {
  if (!accelerator) return [];
  return accelerator.split("+").map((p, i, all) => {
    if (i < all.length - 1) return modLabel(p);
    if (/^Key[A-Z]$/.test(p)) return p.slice(3);
    if (/^Digit\d$/.test(p)) return p.slice(5);
    if (/^Numpad/.test(p)) return `Num ${p.slice(6)}`;
    return KEY_LABELS[p] ?? p;
  });
}

/** Shortcuts Mixdeck itself uses inside the window; a global hotkey would take them over. */
export const APP_SHORTCUTS: Readonly<Record<string, string>> = {
  "Control+Comma": "Mixdeck uses Ctrl+, to open Settings.",
};
