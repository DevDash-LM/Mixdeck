import { useRef, type KeyboardEvent, type MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Settings as SettingsIcon } from "lucide-react";
import { IconButton } from "@/components/ui";
import BrandMark from "@/components/slots/BrandMark";
import TabIndicator from "@/components/slots/TabIndicator";
import { inTauri } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { useNavigation } from "@/stores/navigationStore";
import { listTabViews, listTitleBarItems } from "./routes";
import { WindowControls } from "./WindowControls";

export const MAIN_PANEL_ID = "main-view";

/** Elements that must stay clickable inside the drag area. */
const NO_DRAG = "button, a, input, select, textarea, [role='tab'], [data-no-drag]";

/**
 * Drag handling: double-click toggles maximize; a press followed by movement starts a native
 * window drag (so Aero snap works). Starting the drag on move rather than mousedown keeps the
 * second click of a double-click visible to the webview.
 */
function useDragRegion() {
  const pending = useRef(false);
  const onMouseDown = (e: MouseEvent) => {
    if (!inTauri || e.button !== 0) return;
    if ((e.target as HTMLElement).closest(NO_DRAG)) return;
    if (e.detail === 2) {
      pending.current = false;
      void getCurrentWindow().toggleMaximize().catch(() => undefined);
      return;
    }
    pending.current = true;
  };
  const onMouseMove = (e: MouseEvent) => {
    if (!pending.current) return;
    if ((e.buttons & 1) === 0) {
      pending.current = false;
      return;
    }
    pending.current = false;
    void getCurrentWindow().startDragging().catch(() => undefined);
  };
  const onMouseUp = () => {
    pending.current = false;
  };
  return { onMouseDown, onMouseMove, onMouseUp };
}

function ViewTabs() {
  const current = useNavigation((s) => s.current);
  const navigate = useNavigation((s) => s.navigate);
  const tabs = listTabViews();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent, index: number) => {
    let next = -1;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const tab = tabs[next];
    if (!tab) return;
    navigate(tab.id);
    refs.current[next]?.focus();
  };

  return (
    <nav role="tablist" aria-label="Views" className="flex h-full items-stretch">
      {tabs.map((v, i) => {
        const active = v.id === current;
        return (
          <button
            key={v.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={MAIN_PANEL_ID}
            tabIndex={active || (!tabs.some((t) => t.id === current) && i === 0) ? 0 : -1}
            onClick={() => navigate(v.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "relative inline-flex items-center px-3 text-13 transition-colors duration-150 ease-out",
              "focus-visible:outline-offset-[-2px]",
              active ? "text-text" : "text-text-dim hover:text-text",
            )}
          >
            {v.label}
            {active ? <TabIndicator layoutId="titlebar-tab" /> : null}
          </button>
        );
      })}
    </nav>
  );
}

export function TitleBar() {
  const drag = useDragRegion();
  const current = useNavigation((s) => s.current);
  const navigate = useNavigation((s) => s.navigate);
  const back = useNavigation((s) => s.back);
  const items = listTitleBarItems();
  const inSettings = current === "settings";

  return (
    <header
      className="flex shrink-0 items-stretch border-b border-line bg-bg"
      style={{ height: "var(--titlebar-h)" }}
      {...drag}
    >
      <div className="flex items-center gap-2 pr-2 pl-3">
        <BrandMark size={16} />
        <span className="text-13 font-medium text-text">Mixdeck</span>
      </div>
      <div className="mx-1 my-2.5 w-px bg-line" aria-hidden />
      <ViewTabs />
      {/* Empty space is the drag area. */}
      <div className="min-w-6 flex-1" />
      <div className="flex items-center gap-1 pr-2" data-no-drag>
        {items.map(({ id, component: Item }) => (
          <Item key={id} />
        ))}
        <IconButton
          label={inSettings ? "Close settings" : "Settings"}
          size="sm"
          active={inSettings}
          icon={<SettingsIcon size={16} strokeWidth={1.5} />}
          onClick={() => (inSettings ? back() : navigate("settings"))}
        />
      </div>
      <WindowControls />
    </header>
  );
}
