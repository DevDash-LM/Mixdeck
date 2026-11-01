import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, CircleCheck, Plus, Trash2 } from "lucide-react";
import EmptyIllustration from "@/components/slots/EmptyIllustration";
import { Button, EmptyState, IconButton, Kbd, Select, Spinner, type SelectGroup } from "@/components/ui";
import { bridge, errorMessage, inTauri, type Hotkey, type HotkeyAction, type HotkeyStatus, type Target } from "@/lib/bridge";
import { busTitle, stripName } from "@/features/mixer/labels";
import { MixerShortcuts } from "@/features/mixer/MixerShortcuts";
import { useEnsurePresets, usePresets } from "@/features/presets/presetsStore";
import { BUSES, STRIPS } from "@/lib/params";
import { cn } from "@/lib/cn";
import { useMixer } from "@/stores/mixerStore";
import { APP_SHORTCUTS, acceleratorParts, fromKeyEvent } from "./accelerator";
import type { SettingsSectionProps } from "./sections";

const MAX_HOTKEYS = 64;
type ActionKey = "toggleWindow" | "toggleMute" | "gainUp" | "gainDown" | "loadPreset";
const STEPS = ["0.5", "1", "2", "3", "6"] as const;
const DEFAULT_TARGET: Target = { kind: "strip", index: 0 };
const NONE: readonly { label: string }[] = [];

function actionKey(a: HotkeyAction): ActionKey {
  if (a.kind === "gain") return a.delta >= 0 ? "gainUp" : "gainDown";
  return a.kind;
}

function targetOf(a: HotkeyAction): Target {
  return a.kind === "toggleMute" || a.kind === "gain" ? a.target : DEFAULT_TARGET;
}

const targetValue = (t: Target) => `${t.kind}:${t.index}`;
function parseTarget(v: string): Target {
  const [kind, index] = v.split(":");
  return { kind: kind === "bus" ? "bus" : "strip", index: Number(index) || 0 };
}

// ---- Recorder ----

interface RecorderProps {
  index: number;
  accelerator: string;
  recording: boolean;
  onStart: () => void;
  onStop: () => void;
  onRecorded: (accelerator: string) => void;
  /** Local conflict for a candidate (duplicate in the list, an in-app shortcut). */
  conflict: (accelerator: string) => string | null;
}

function ShortcutRecorder({ index, accelerator, recording, onStart, onStop, onRecorded, conflict }: RecorderProps) {
  const [preview, setPreview] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  // Latest callbacks, so the key listener only re-subscribes when recording starts/stops.
  const cb = useRef({ onStop, onRecorded, conflict });
  cb.current = { onStop, onRecorded, conflict };

  useEffect(() => {
    if (!recording) {
      setPreview("");
      return;
    }
    setMessage(null);
    button.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      e.preventDefault();
      e.stopPropagation();
      const r = fromKeyEvent(e);
      if (r.kind === "modifierOnly") return setPreview(r.preview);
      if (r.kind === "cancel") return cb.current.onStop();
      if (r.kind === "error") return setMessage(r.message);
      const local = cb.current.conflict(r.accelerator);
      if (local) return setMessage(local);
      setChecking(true);
      bridge
        .checkHotkey(r.accelerator)
        .then(() => {
          cb.current.onRecorded(r.accelerator);
          cb.current.onStop();
        })
        .catch((err) => setMessage(errorMessage(err)))
        .finally(() => setChecking(false));
    };
    const onKeyUp = () => setPreview("");
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [recording]);

  const parts = acceleratorParts(accelerator);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <button
        ref={button}
        type="button"
        onClick={recording ? onStop : onStart}
        onBlur={() => recording && !checking && onStop()}
        aria-label={
          recording
            ? `Recording hotkey ${index + 1}. Press the keys, or Escape to cancel.`
            : parts.length
              ? `Hotkey ${index + 1}: ${parts.join(" ")}. Press to change.`
              : `Hotkey ${index + 1}: not set. Press to record.`
        }
        className={cn(
          "flex h-8 w-44 items-center gap-1 rounded-md border px-2 text-left transition-colors duration-150 ease-out",
          recording ? "border-text-dim bg-panel-2" : "border-line bg-panel-2 hover:border-line-strong",
        )}
      >
        {recording ? (
          <span className="flex items-center gap-1.5 truncate text-12 text-text">
            {checking ? <Spinner size={12} /> : <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-mute" />}
            {preview ? `${preview}+…` : "Press keys…"}
          </span>
        ) : parts.length ? (
          parts.map((p, i) => <Kbd key={i}>{p}</Kbd>)
        ) : (
          <span className="text-12 text-text-faint">Record shortcut</span>
        )}
      </button>
      {recording && message ? (
        <p role="alert" className="w-44 text-11 text-mute">
          {message}
        </p>
      ) : null}
    </div>
  );
}

// ---- Status line ----

function StatusLine({ hotkey, status }: { hotkey: Hotkey; status: HotkeyStatus | undefined }) {
  const presets = usePresets((s) => s.list);
  const presetsReady = usePresets((s) => s.status === "ready");
  const missingPreset =
    hotkey.action.kind === "loadPreset" &&
    presetsReady &&
    !presets.some((p) => p.id === (hotkey.action as { id: string }).id && !p.error);

  let tone: "ok" | "warn" | "dim" = "dim";
  let text: string | null = null;
  if (!hotkey.accelerator) {
    text = "Not set yet. Record a shortcut to turn it on.";
  } else if (!status || status.accelerator !== hotkey.accelerator) {
    text = null;
  } else if (status.state === "registered") {
    tone = "ok";
    text = "Active everywhere in Windows";
  } else if (status.state === "paused") {
    text = "Paused while recording";
  } else {
    tone = "warn";
    text = status.message ?? "This shortcut isn't active.";
  }
  if (missingPreset) {
    tone = "warn";
    text = "The preset this loads was deleted. Pick another.";
  }
  if (!text) return null;
  const Icon = tone === "warn" ? CircleAlert : CircleCheck;
  return (
    <p className={cn("flex items-center gap-1.5 text-11", tone === "warn" ? "text-mute" : "text-text-faint")}>
      {tone !== "dim" ? <Icon size={12} strokeWidth={1.5} aria-hidden /> : null}
      {text}
    </p>
  );
}

// ---- Row ----

interface RowProps {
  index: number;
  hotkey: Hotkey;
  status: HotkeyStatus | undefined;
  recording: boolean;
  targetOptions: SelectGroup[];
  onRecord: (on: boolean) => void;
  onChange: (next: Hotkey) => void;
  onDelete: () => void;
  conflict: (accelerator: string) => string | null;
}

function HotkeyRow({ index, hotkey, status, recording, targetOptions, onRecord, onChange, onDelete, conflict }: RowProps) {
  const presets = usePresets((s) => s.list).filter((p) => !p.error);
  const action = hotkey.action;
  const key = actionKey(action);
  const target = targetOf(action);

  const setAction = (next: HotkeyAction) => onChange({ ...hotkey, action: next });
  const changeKind = (k: string) => {
    const step = action.kind === "gain" ? Math.abs(action.delta) : 1;
    switch (k as ActionKey) {
      case "toggleWindow":
        return setAction({ kind: "toggleWindow" });
      case "toggleMute":
        return setAction({ kind: "toggleMute", target });
      case "gainUp":
        return setAction({ kind: "gain", target, delta: step });
      case "gainDown":
        return setAction({ kind: "gain", target, delta: -step });
      case "loadPreset":
        if (presets[0]) setAction({ kind: "loadPreset", id: presets[0].id });
    }
  };

  const onStart = () => onRecord(true);
  const onStop = () => onRecord(false);
  const onRecorded = (accelerator: string) => onChange({ ...hotkey, accelerator });

  return (
    <li className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start gap-2">
        <ShortcutRecorder
          index={index}
          accelerator={hotkey.accelerator}
          recording={recording}
          onStart={onStart}
          onStop={onStop}
          onRecorded={onRecorded}
          conflict={conflict}
        />
        <Select
          aria-label={`Action for hotkey ${index + 1}`}
          className="w-40"
          value={key}
          onValueChange={changeKind}
          options={[
            { value: "toggleWindow", label: "Show / hide Mixdeck" },
            { value: "toggleMute", label: "Toggle mute" },
            { value: "gainUp", label: "Gain up" },
            { value: "gainDown", label: "Gain down" },
            {
              value: "loadPreset",
              label: presets.length ? "Load preset" : "Load preset (save one first)",
              disabled: presets.length === 0,
            },
          ]}
        />
        {action.kind === "toggleMute" || action.kind === "gain" ? (
          <Select
            aria-label={`Strip or bus for hotkey ${index + 1}`}
            className="w-36"
            value={targetValue(target)}
            onValueChange={(v) =>
              setAction(action.kind === "gain" ? { ...action, target: parseTarget(v) } : { kind: "toggleMute", target: parseTarget(v) })
            }
            options={targetOptions}
          />
        ) : null}
        {action.kind === "gain" ? (
          <Select
            aria-label={`Gain step for hotkey ${index + 1}`}
            className="w-24"
            value={String(Math.abs(action.delta))}
            onValueChange={(v) => setAction({ ...action, delta: Math.sign(action.delta || 1) * Number(v) })}
            options={STEPS.map((s) => ({ value: s, label: `${s} dB` }))}
          />
        ) : null}
        {action.kind === "loadPreset" ? (
          <Select
            aria-label={`Preset for hotkey ${index + 1}`}
            className="w-48"
            value={presets.some((p) => p.id === action.id) ? action.id : undefined}
            placeholder="Preset deleted"
            onValueChange={(id) => setAction({ kind: "loadPreset", id })}
            options={presets.map((p) => ({ value: p.id, label: p.name }))}
            emptyText="No presets yet"
          />
        ) : null}
        <IconButton
          className="ml-auto"
          label={`Remove hotkey ${index + 1}`}
          size="sm"
          icon={<Trash2 size={14} strokeWidth={1.5} />}
          onClick={onDelete}
        />
      </div>
      <StatusLine hotkey={hotkey} status={status} />
    </li>
  );
}

// ---- Section ----

export default function HotkeysSection({ settings, update }: SettingsSectionProps) {
  useEnsurePresets();
  const hotkeys = settings.hotkeys;
  const strips = useMixer((s) => s.state?.strips ?? NONE);
  const buses = useMixer((s) => s.state?.buses ?? NONE);
  const [status, setStatus] = useState<HotkeyStatus[]>([]);
  const [recording, setRecording] = useState<number | null>(null);

  const refreshStatus = useCallback(() => {
    if (!inTauri) return;
    bridge
      .getHotkeyStatus()
      .then(setStatus)
      .catch(() => undefined);
  }, []);

  const signature = JSON.stringify(hotkeys);
  useEffect(refreshStatus, [refreshStatus, signature]);

  // Hotkeys are off while recording, so pressing an existing one records it instead of firing.
  const isRecording = recording !== null;
  useEffect(() => {
    if (!isRecording || !inTauri) return;
    bridge
      .setHotkeysPaused(true)
      .then(setStatus)
      .catch(() => undefined);
    return () => {
      bridge
        .setHotkeysPaused(false)
        .then(setStatus)
        .catch(() => undefined);
    };
  }, [isRecording]);

  const save = useCallback(
    (next: Hotkey[]) => {
      update({ hotkeys: next })
        .catch(() => undefined)
        .finally(refreshStatus);
    },
    [update, refreshStatus],
  );

  const targetOptions = useMemo<SelectGroup[]>(
    () => [
      {
        label: "Inputs",
        options: Array.from({ length: STRIPS }, (_, i) => ({
          value: targetValue({ kind: "strip", index: i }),
          label: stripName(i, strips[i]?.label ?? ""),
        })),
      },
      {
        label: "Buses",
        options: Array.from({ length: BUSES }, (_, j) => ({
          value: targetValue({ kind: "bus", index: j }),
          label: busTitle(j, buses[j]?.label ?? ""),
        })),
      },
    ],
    [strips, buses],
  );

  const conflictFor = useCallback(
    (index: number) => (accelerator: string) => {
      const other = hotkeys.findIndex((h, i) => i !== index && h.accelerator === accelerator);
      if (other >= 0) return `Hotkey ${other + 1} already uses this shortcut.`;
      return APP_SHORTCUTS[accelerator] ?? null;
    },
    [hotkeys],
  );
  const conflicts = useMemo(() => hotkeys.map((_, i) => conflictFor(i)), [hotkeys, conflictFor]);

  const add = () => {
    save([...hotkeys, { accelerator: "", action: { kind: "toggleWindow" } }]);
    setRecording(hotkeys.length);
  };

  if (hotkeys.length === 0) {
    return (
      <div className="flex flex-col gap-3">
      <EmptyState
        illustration={<EmptyIllustration variant="hotkeys" />}
        title="No hotkeys yet"
        description="Mute a mic, nudge a volume, load a preset or show Mixdeck from anywhere in Windows, even while it's hidden."
        actions={
          <Button variant="secondary" size="sm" icon={<Plus size={14} strokeWidth={1.5} />} onClick={add}>
            Add hotkey
          </Button>
        }
      />
      <MixerShortcuts />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-12 text-text-dim">
        These work everywhere in Windows, even while Mixdeck is hidden. Click a shortcut to record a new one; Esc
        cancels.
      </p>
      <ul className="flex flex-col divide-y divide-line">
        {hotkeys.map((h, i) => (
          <HotkeyRow
            key={i}
            index={i}
            hotkey={h}
            status={status[i]}
            recording={recording === i}
            targetOptions={targetOptions}
            onRecord={(on) => setRecording((cur) => (on ? i : cur === i ? null : cur))}
            onChange={(next) => save(hotkeys.map((x, k) => (k === i ? next : x)))}
            onDelete={() => {
              setRecording(null);
              save(hotkeys.filter((_, k) => k !== i));
            }}
            conflict={conflicts[i] ?? (() => null)}
          />
        ))}
      </ul>
      <div>
        <Button
          variant="ghost"
          size="sm"
          icon={<Plus size={14} strokeWidth={1.5} />}
          onClick={add}
          disabled={hotkeys.length >= MAX_HOTKEYS}
        >
          Add hotkey
        </Button>
      </div>
      <MixerShortcuts />
    </div>
  );
}
