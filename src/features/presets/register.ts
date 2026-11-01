/**
 * Preset registrations (side-effect import in `routes.ts`):
 * - the Mixer/Routing "Save preset" action opens the global Save dialog;
 * - toasts raised in Rust (`notify://toast`: hotkeys, tray preset loads) are shown here.
 * The tray's Presets ▸ items are loaded in Rust, so there's no `trayEvents.onPreset` handler.
 */
import { registerMixerActions } from "@/features/mixer/extensions";
import { toast } from "@/components/ui";
import { inTauri, notifyEvents } from "@/lib/bridge";
import { usePresets } from "./presetsStore";

registerMixerActions({ savePreset: () => usePresets.getState().openSave() });

if (inTauri) {
  notifyEvents
    .onToast((n) => {
      const o = { id: n.key ?? undefined, description: n.description ?? undefined };
      if (n.kind === "success") toast.success(n.title, o);
      else if (n.kind === "error") toast.error(n.title, o);
      else toast.info(n.title, { ...o, duration: 2000 });
    })
    .catch(() => undefined);
}
