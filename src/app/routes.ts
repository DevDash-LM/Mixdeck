/**
 * View registry.
 *
 * Add a view by adding its component file and ONE `registerView(...)` line at the bottom of this
 * file. Tab views (tab !== false) appear in the title bar in `order`; others (e.g. Settings) are
 * reached via navigation (`useNavigation().navigate(id)`).
 *
 * Title-bar items (e.g. the connection pill) register with `registerTitleBarItem`.
 */
import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import { Bookmark, Grid3x3, Settings as SettingsIcon, Shapes, SlidersVertical } from "lucide-react";
import MixerView from "@/features/mixer/MixerView";
import RoutingView from "@/features/routing/RoutingView";
import ConnectionPill from "@/features/connection/ConnectionPill";
import PresetsView from "@/features/presets/PresetsView";
import SavePresetButton from "@/features/presets/SavePresetButton";
import SettingsView from "@/features/settings/SettingsView";
import ControlKitView from "@/features/devkit/ControlKitView";

export interface ViewDef {
  /** Stable id used for navigation ("mixer", "routing", "presets", "settings", …). */
  id: string;
  label: string;
  icon: LucideIcon;
  component: ComponentType;
  /** Show as a title-bar tab (default true). */
  tab?: boolean;
  /** Tab sort key, ascending (default 100). */
  order?: number;
}

export interface TitleBarItemDef {
  id: string;
  component: ComponentType;
  /** Sort key, ascending, left → right; rendered left of the Settings button (default 100). */
  order?: number;
}

const views = new Map<string, ViewDef>();
const titleBarItems = new Map<string, TitleBarItemDef>();

export function registerView(def: ViewDef): void {
  if (views.has(def.id)) console.warn(`registerView: replacing view "${def.id}"`);
  views.set(def.id, def);
}

export function registerTitleBarItem(def: TitleBarItemDef): void {
  titleBarItems.set(def.id, def);
}

const byOrder = <T extends { order?: number }>(a: T, b: T) => (a.order ?? 100) - (b.order ?? 100);

export function getView(id: string): ViewDef | undefined {
  return views.get(id);
}

export function listViews(): ViewDef[] {
  return [...views.values()].sort(byOrder);
}

export function listTabViews(): ViewDef[] {
  return listViews().filter((v) => v.tab !== false);
}

export function listTitleBarItems(): TitleBarItemDef[] {
  return [...titleBarItems.values()].sort(byOrder);
}

// ---- Registrations: one line per view ----
registerView({ id: "mixer", label: "Mixer", icon: SlidersVertical, component: MixerView, order: 10 });
registerView({ id: "routing", label: "Routing", icon: Grid3x3, component: RoutingView, order: 20 });
registerView({ id: "presets", label: "Presets", icon: Bookmark, component: PresetsView, order: 30 });
registerView({ id: "settings", label: "Settings", icon: SettingsIcon, component: SettingsView, tab: false });
if (import.meta.env.DEV) registerView({ id: "control-kit", label: "Kit", icon: Shapes, component: ControlKitView, order: 900 });

// ---- Feature registrations into other views (side-effect imports, one line per feature) ----
import "@/features/routing/register";
import "@/features/devices/register";
import "@/features/strip-fx/register";
import "@/features/bus-eq/register";
import "@/features/presets/register";
import "@/features/apps/register";

// ---- Title-bar items ----
registerTitleBarItem({ id: "save-preset", component: SavePresetButton, order: 5 });
registerTitleBarItem({ id: "connection", component: ConnectionPill, order: 10 });
