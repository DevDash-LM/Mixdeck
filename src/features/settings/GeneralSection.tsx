import { Toggle } from "@/components/ui";
import type { SettingsSectionProps } from "./sections";

export default function GeneralSection({ settings, update }: SettingsSectionProps) {
  const set = (patch: Parameters<typeof update>[0]) => {
    update(patch).catch(() => undefined);
  };
  return (
    <div className="flex flex-col divide-y divide-line">
      <Toggle
        className="py-3 first:pt-0"
        label="Start minimized to tray"
        description="Mixdeck starts in the system tray. Click the tray icon to open it."
        checked={settings.startMinimized}
        onCheckedChange={(v) => set({ startMinimized: v })}
      />
      <Toggle
        className="py-3"
        label="Close to tray"
        description="The close button hides Mixdeck to the tray. When off, closing the window quits."
        checked={settings.closeToTray}
        onCheckedChange={(v) => set({ closeToTray: v })}
      />
      <Toggle
        className="py-3 last:pb-0"
        label="Launch at login"
        description="Start Mixdeck when you sign in to Windows."
        checked={settings.launchAtLogin}
        onCheckedChange={(v) => set({ launchAtLogin: v })}
      />
    </div>
  );
}
