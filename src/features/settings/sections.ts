/**
 * Settings section registry. Add a section by adding its component file and ONE
 * `registerSettingsSection(...)` line at the bottom of this file.
 */
import type { ComponentType } from "react";
import type { Settings, SettingsPatch } from "@/lib/bridge";
import AboutSection from "./AboutSection";
import GeneralSection from "./GeneralSection";
import HotkeysSection from "./HotkeysSection";
import MetersSection from "./MetersSection";

export interface SettingsSectionProps {
  settings: Settings;
  /** Persists a partial update. Errors are already surfaced as a toast; the promise still rejects. */
  update: (patch: SettingsPatch) => Promise<void>;
}

export interface SettingsSectionDef {
  id: string;
  title: string;
  component: ComponentType<SettingsSectionProps>;
  /** Sort key, ascending (default 100). About uses 1000 to stay last. */
  order?: number;
}

const sections = new Map<string, SettingsSectionDef>();

export function registerSettingsSection(def: SettingsSectionDef): void {
  sections.set(def.id, def);
}

export function listSettingsSections(): SettingsSectionDef[] {
  return [...sections.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

// ---- Registrations: one line per section ----
registerSettingsSection({ id: "general", title: "General", component: GeneralSection, order: 10 });
registerSettingsSection({ id: "meters", title: "Meters", component: MetersSection, order: 20 });
registerSettingsSection({ id: "hotkeys", title: "Hotkeys", component: HotkeysSection, order: 30 });
registerSettingsSection({ id: "about", title: "About", component: AboutSection, order: 1000 });
