import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button, Dialog, Toggle, toast } from "@/components/ui";
import { bridge, errorMessage } from "@/lib/bridge";
import { useMixer } from "@/stores/mixerStore";
import { useNavigation } from "@/stores/navigationStore";
import { PRESET_SECTIONS, PRESETS_VIEW, useEnsurePresets, usePresets, type PresetSection } from "./presetsStore";
import { TextInput } from "./TextInput";

const NAME_MAX = 64;
const FORM_ID = "save-preset-form";

function defaultName(): string {
  return `Mix ${new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`;
}

/** The one Save preset dialog, opened from the title bar, Routing, or the Presets view. */
export default function SavePresetDialog() {
  useEnsurePresets();
  const open = usePresets((s) => s.saveOpen);
  const setOpen = usePresets((s) => s.setSaveOpen);
  const list = usePresets((s) => s.list);
  const connected = useMixer((s) => s.connection.status === "connected");
  const current = useNavigation((s) => s.current);
  const navigate = useNavigation((s) => s.navigate);

  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Record<PresetSection["key"], boolean>>({
    core: true,
    stripFx: true,
    busEq: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(defaultName());
      setError(null);
    }
  }, [open]);

  const trimmed = name.trim();
  const existing = useMemo(
    () => list.find((p) => !p.error && p.name.trim().toLowerCase() === trimmed.toLowerCase()),
    [list, trimmed],
  );
  const groups = PRESET_SECTIONS.filter((s) => picked[s.key]).flatMap((s) => s.ids);
  const nameError = trimmed.length === 0 ? "Give the preset a name." : trimmed.length > NAME_MAX ? `Up to ${NAME_MAX} characters.` : null;
  const canSave = connected && !nameError && groups.length > 0 && !busy;

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await bridge.savePreset(trimmed, groups, Boolean(existing));
      setOpen(false);
      toast.success(existing ? `Replaced “${saved.name}”` : `Saved “${saved.name}”`, {
        description: `${saved.paramCount.toLocaleString()} values.`,
        action: current === PRESETS_VIEW ? undefined : { label: "View presets", onClick: () => navigate(PRESETS_VIEW) },
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !busy && setOpen(next)}
      title="Save preset"
      description="Saves a snapshot of Voicemeeter's current settings. Load it later to get this mix back."
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} variant="primary" loading={busy} disabled={!canSave}>
            {existing ? "Replace" : "Save"}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-12 text-text-dim">Name</span>
          <TextInput
            autoFocus
            value={name}
            maxLength={NAME_MAX + 8}
            invalid={Boolean(nameError) && name.length > 0}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setName(e.currentTarget.value)}
            aria-describedby="save-preset-name-hint"
          />
          <span id="save-preset-name-hint" className="text-12 text-text-faint" aria-live="polite">
            {nameError && name.length > 0
              ? nameError
              : existing
                ? `A preset named “${existing.name}” exists. Saving replaces it.`
                : " "}
          </span>
        </label>

        <fieldset className="flex flex-col divide-y divide-line rounded-md border border-line px-3">
          <legend className="px-1 text-12 text-text-dim">Include</legend>
          {PRESET_SECTIONS.map((s) => (
            <Toggle
              key={s.key}
              className="py-2.5"
              label={s.label}
              description={s.description}
              checked={picked[s.key]}
              onCheckedChange={(v) => setPicked((p) => ({ ...p, [s.key]: v }))}
            />
          ))}
        </fieldset>
        {groups.length === 0 ? <p className="text-12 text-mute">Choose at least one thing to save.</p> : null}
        <p className="text-12 text-text-faint">Audio devices aren't saved, so a preset works on any PC.</p>

        {!connected ? (
          <p className="text-12 text-mute">
            Voicemeeter isn't connected, so there's nothing to save yet. The connection status is at the top
            right.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-12 text-mute">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
