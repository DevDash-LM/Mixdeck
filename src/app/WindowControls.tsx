import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { inTauri } from "@/lib/bridge";
import { cn } from "@/lib/cn";

/** Minimize / maximize-restore / close, Windows-style (46px wide, full bar height). */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!inTauri) return;
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    let alive = true;
    const sync = () => {
      win
        .isMaximized()
        .then((m) => alive && setMaximized(m))
        .catch(() => undefined);
    };
    sync();
    win
      .onResized(sync)
      .then((u) => {
        if (alive) unlisten = u;
        else u();
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  const act = (fn: (w: ReturnType<typeof getCurrentWindow>) => Promise<void>) => () => {
    if (inTauri) void fn(getCurrentWindow()).catch(() => undefined);
  };

  const base =
    "inline-flex h-full w-[46px] items-center justify-center text-text-dim transition-colors duration-150 ease-out " +
    "focus-visible:outline-offset-[-2px]";

  return (
    <div className="flex h-full items-stretch" data-no-drag>
      <button type="button" aria-label="Minimize" className={cn(base, "hover:bg-panel-2 hover:text-text")} onClick={act((w) => w.minimize())}>
        <Minus size={16} strokeWidth={1.5} />
      </button>
      <button
        type="button"
        aria-label={maximized ? "Restore" : "Maximize"}
        className={cn(base, "hover:bg-panel-2 hover:text-text")}
        onClick={act((w) => w.toggleMaximize())}
      >
        {maximized ? <Copy size={14} strokeWidth={1.5} className="-scale-x-100" /> : <Square size={13} strokeWidth={1.5} />}
      </button>
      <button type="button" aria-label="Close" className={cn(base, "hover:bg-mute hover:text-fg")} onClick={act((w) => w.close())}>
        <X size={16} strokeWidth={1.5} />
      </button>
    </div>
  );
}
