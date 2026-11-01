import { Select } from "@/components/ui";
import type { SettingsSectionProps } from "./sections";

const MODES = [
  { value: "0", label: "Pre-fader", hint: "The input level before the fader, so meters move even when the fader is down." },
  { value: "1", label: "Post-fader", hint: "The level after the fader. Matches what you hear. Default." },
  { value: "2", label: "Post-mute", hint: "Like post-fader, but a muted strip's meter drops to silence." },
] as const;

export default function MetersSection({ settings, update }: SettingsSectionProps) {
  const current = MODES.find((m) => m.value === String(settings.meterMode)) ?? MODES[1];
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-13 text-text">
          Input meters show
        </p>
        <p className="text-12 text-text-dim">{current.hint}</p>
      </div>
      <Select
        aria-label="Input meters show"
        className="w-40 shrink-0"
        value={current.value}
        onValueChange={(v) => update({ meterMode: Number(v) }).catch(() => undefined)}
        options={MODES.map((m) => ({ value: m.value, label: m.label }))}
      />
    </div>
  );
}
