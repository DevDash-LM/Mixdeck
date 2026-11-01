import { Save } from "lucide-react";
import { IconButton } from "@/components/ui";
import SavePresetDialog from "./SavePresetDialog";
import { usePresets } from "./presetsStore";

/**
 * Title-bar "Save preset" quick action (Mixer and every other view). It also hosts the single
 * Save dialog, which Routing and the Presets view open through `usePresets().openSave()`.
 */
export default function SavePresetButton() {
  const openSave = usePresets((s) => s.openSave);
  return (
    <>
      <IconButton label="Save preset" size="sm" icon={<Save size={16} strokeWidth={1.5} />} onClick={openSave} />
      <SavePresetDialog />
    </>
  );
}
