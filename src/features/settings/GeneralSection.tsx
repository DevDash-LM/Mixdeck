import { useState } from "react";
import { Power } from "lucide-react";
import { Button, Toggle, toast } from "@/components/ui";
import { bridge, errorMessage, inTauri } from "@/lib/bridge";
import type { SettingsSectionProps } from "./sections";

function QuitRow() {
  const [busy, setBusy] = useState(false);
  const quit = async () => {
    setBusy(true);
    try {
      await bridge.quitApp();
    } catch (err) {
      setBusy(false);
      toast.error("Couldn't quit Mixdeck", { description: errorMessage(err) });
    }
  };
  return (
    <div className="flex items-center justify-between gap-4 py-3 last:pb-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-13 text-text">Quit Mixdeck</span>
        <span className="text-12 text-text-dim">
          Close the window and remove the tray icon. Voicemeeter keeps running and your mix is unchanged.
        </span>
      </div>
      <Button
        size="sm"
        variant="secondary"
        onClick={quit}
        loading={busy}
        disabled={!inTauri}
        icon={<Power size={14} strokeWidth={1.5} />}
      >
        Quit
      </Button>
    </div>
  );
}

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
        className="py-3"
        label="Launch at login"
        description="Start Mixdeck when you sign in to Windows."
        checked={settings.launchAtLogin}
        onCheckedChange={(v) => set({ launchAtLogin: v })}
      />
      <QuitRow />
    </div>
  );
}
