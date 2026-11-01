import { useEffect, useState, type FormEvent } from "react";
import { open as openFile, save as saveFile } from "@tauri-apps/plugin-dialog";
import { FileDown, FileUp, FolderOpen, MoreHorizontal, Pencil, Play, Save, Trash2, TriangleAlert } from "lucide-react";
import EmptyIllustration from "@/components/slots/EmptyIllustration";
import {
  Button,
  ConfirmDialog,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  IconButton,
  Skeleton,
  Tooltip,
  toast,
} from "@/components/ui";
import { bridge, errorMessage, inTauri, type PresetSummary } from "@/lib/bridge";
import { useMixer } from "@/stores/mixerStore";
import { useNavigation } from "@/stores/navigationStore";
import { useSettings } from "@/stores/settingsStore";
import { describeGroups, formatSavedAt, loadPreset, useEnsurePresets, usePresets } from "./presetsStore";
import { TextInput } from "./TextInput";

/** Stable fallback: a fresh `[]` in a zustand v5 selector re-renders forever. */
const NO_HOTKEYS: readonly never[] = [];
const XML_FILTER = [{ name: "Voicemeeter settings", extensions: ["xml"] }];
const icon = (I: typeof Save) => <I size={14} strokeWidth={1.5} />;

function RenameDialog({ preset, onClose }: { preset: PresetSummary | null; onClose: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (preset) {
      setName(preset.name);
      setError(null);
    }
  }, [preset]);
  const trimmed = name.trim();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!preset || !trimmed || trimmed === preset.name) return onClose();
    setBusy(true);
    setError(null);
    try {
      await bridge.renamePreset(preset.id, trimmed);
      toast.success(`Renamed to “${trimmed}”`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={preset !== null}
      onOpenChange={(o) => !o && !busy && onClose()}
      title="Rename preset"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="rename-preset-form" variant="primary" loading={busy} disabled={!trimmed}>
            Rename
          </Button>
        </>
      }
    >
      <form id="rename-preset-form" onSubmit={submit} className="flex flex-col gap-1.5">
        <label className="flex flex-col gap-1.5">
          <span className="text-12 text-text-dim">Name</span>
          <TextInput
            autoFocus
            value={name}
            maxLength={72}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setName(e.currentTarget.value)}
          />
        </label>
        <p className="text-12 text-text-faint">Hotkeys that load this preset keep working after a rename.</p>
        {error ? (
          <p role="alert" className="text-12 text-mute">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

function PresetRow({
  preset,
  connected,
  onLoad,
  onRename,
  onDelete,
}: {
  preset: PresetSummary;
  connected: boolean;
  onLoad: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const broken = preset.error !== null;
  const groups = describeGroups(preset.groups);
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="flex items-center gap-1.5 truncate text-13 font-medium text-text">
          {broken ? <TriangleAlert size={14} strokeWidth={1.5} className="shrink-0 text-mute" aria-hidden /> : null}
          <span className="truncate">{broken ? `${preset.id}.json` : preset.name}</span>
        </p>
        <p className="truncate text-12 text-text-dim">
          {broken
            ? preset.error
            : `${formatSavedAt(preset.createdAt)} · ${groups.join(", ") || "Nothing"} · ${preset.paramCount.toLocaleString()} values`}
        </p>
      </div>
      {broken ? (
        <Button variant="ghost" size="sm" icon={icon(Trash2)} onClick={onDelete}>
          Delete
        </Button>
      ) : (
        <>
          {connected ? (
            <Button variant="secondary" size="sm" icon={icon(Play)} onClick={onLoad}>
              Load
            </Button>
          ) : (
            <Tooltip content="Connect Voicemeeter to load presets">
              <span>
                <Button variant="secondary" size="sm" icon={icon(Play)} disabled>
                  Load
                </Button>
              </span>
            </Tooltip>
          )}
          <DropdownMenu>
            <Tooltip content="More">
              <DropdownMenuTrigger asChild>
                <IconButton label={`More for ${preset.name}`} tooltip={false} size="sm" icon={icon(MoreHorizontal)} />
              </DropdownMenuTrigger>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem icon={icon(Pencil)} onSelect={onRename}>
                Rename…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem icon={icon(Trash2)} destructive onSelect={onDelete}>
                Delete…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </li>
  );
}

function ListSkeleton() {
  return (
    <ul className="divide-y divide-line rounded-lg border border-line bg-panel" aria-busy aria-label="Loading presets">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-64" />
          </div>
          <Skeleton className="h-7 w-16" />
        </li>
      ))}
    </ul>
  );
}

export default function PresetsView() {
  useEnsurePresets();
  const { list, status, error, refresh, openSave } = usePresets();
  const connected = useMixer((s) => s.connection.status === "connected");
  const navigate = useNavigation((s) => s.navigate);
  const hotkeys = useSettings((s) => s.settings?.hotkeys ?? NO_HOTKEYS);

  const [toLoad, setToLoad] = useState<PresetSummary | null>(null);
  const [toRename, setToRename] = useState<PresetSummary | null>(null);
  const [toDelete, setToDelete] = useState<PresetSummary | null>(null);
  const [xmlToImport, setXmlToImport] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const deleteHotkeys = toDelete
    ? hotkeys.filter((h) => h.action.kind === "loadPreset" && h.action.id === toDelete.id).length
    : 0;

  const pickImport = async () => {
    try {
      const path = await openFile({ multiple: false, directory: false, filters: XML_FILTER, title: "Load Voicemeeter settings" });
      if (typeof path === "string") setXmlToImport(path);
    } catch (err) {
      toast.error("Couldn't open the file picker", { description: errorMessage(err) });
    }
  };

  const exportXml = async () => {
    try {
      const path = await saveFile({ filters: XML_FILTER, defaultPath: "Voicemeeter settings.xml", title: "Save Voicemeeter settings" });
      if (!path) return;
      setExporting(true);
      const message = await bridge.exportVmXml(path);
      toast.success("Exported Voicemeeter settings", { description: message });
    } catch (err) {
      toast.error("Couldn't export Voicemeeter settings", { description: errorMessage(err) });
    } finally {
      setExporting(false);
    }
  };

  const openFolder = () =>
    bridge.openPresetsFolder().catch((err) => toast.error("Couldn't open the presets folder", { description: errorMessage(err) }));

  const saveButton = connected ? (
    <Button variant="primary" size="sm" icon={icon(Save)} onClick={openSave}>
      Save current mix
    </Button>
  ) : (
    <Tooltip content="Connect Voicemeeter to save a preset">
      <span>
        <Button variant="primary" size="sm" icon={icon(Save)} disabled>
          Save current mix
        </Button>
      </span>
    </Tooltip>
  );

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 px-6 py-5">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-16 font-medium text-text">Presets</h1>
            <p className="max-w-[60ch] text-13 text-text-dim">
              Snapshots of your mix. Loading one sets Voicemeeter back to exactly how it was when you saved it.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {saveButton}
            <DropdownMenu>
              <Tooltip content="More preset actions">
                <DropdownMenuTrigger asChild>
                  <IconButton label="More preset actions" tooltip={false} size="sm" icon={icon(MoreHorizontal)} />
                </DropdownMenuTrigger>
              </Tooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuItem icon={icon(FolderOpen)} onSelect={openFolder} disabled={!inTauri}>
                  Open presets folder
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem icon={icon(FileUp)} onSelect={pickImport} disabled={!connected}>
                  Import Voicemeeter XML…
                </DropdownMenuItem>
                <DropdownMenuItem icon={icon(FileDown)} onSelect={exportXml} disabled={!connected || exporting}>
                  Export Voicemeeter XML…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {status === "error" ? (
          <ErrorState title="Couldn't read your presets" message={error ?? undefined} retry={refresh} />
        ) : status !== "ready" ? (
          <ListSkeleton />
        ) : list.length === 0 ? (
          <EmptyState
            className="rounded-lg border border-line bg-panel py-12"
            illustration={<EmptyIllustration variant="presets" />}
            title="No presets yet"
            description="Save your current mix to get back to it with one click, from the tray or a hotkey."
            actions={saveButton}
          />
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-panel">
            {list.map((p) => (
              <PresetRow
                key={p.id}
                preset={p}
                connected={connected}
                onLoad={() => setToLoad(p)}
                onRename={() => setToRename(p)}
                onDelete={() => setToDelete(p)}
              />
            ))}
          </ul>
        )}

        {status === "ready" && list.length > 0 ? (
          <p className="text-12 text-text-faint">
            Presets are also in the tray menu, and Settings → Hotkeys can load one with a key press.
          </p>
        ) : null}
      </div>

      <ConfirmDialog
        open={toLoad !== null}
        onOpenChange={(o) => !o && setToLoad(null)}
        title={`Load “${toLoad?.name ?? ""}”?`}
        description={`This replaces Voicemeeter's ${describeGroups(toLoad?.groups ?? []).join(", ").toLowerCase() || "settings"} with the saved ones. Save the current mix first if you want to keep it.`}
        confirmLabel="Load"
        onConfirm={async () => {
          if (!toLoad) return;
          await loadPreset(toLoad.id);
          navigate("mixer");
        }}
      />

      <RenameDialog preset={toRename} onClose={() => setToRename(null)} />

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Delete “${toDelete?.error ? `${toDelete.id}.json` : (toDelete?.name ?? "")}”?`}
        description={
          deleteHotkeys > 0
            ? `The file is removed for good, and ${deleteHotkeys === 1 ? "1 hotkey" : `${deleteHotkeys} hotkeys`} that load it will stop working.`
            : "The file is removed for good."
        }
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await bridge.deletePreset(toDelete.id);
          } catch (err) {
            throw new Error(errorMessage(err));
          }
          toast.success(`Deleted “${toDelete.error ? toDelete.id : toDelete.name}”`);
        }}
      />

      <ConfirmDialog
        open={xmlToImport !== null}
        onOpenChange={(o) => !o && setXmlToImport(null)}
        title="Load Voicemeeter settings from a file?"
        description={`Voicemeeter will load ${xmlToImport ?? ""}. That replaces all of its settings, including audio devices.`}
        confirmLabel="Load file"
        onConfirm={async () => {
          if (!xmlToImport) return;
          try {
            await bridge.importVmXml(xmlToImport);
          } catch (err) {
            throw new Error(errorMessage(err));
          }
          toast.success("Voicemeeter loaded the settings file");
          navigate("mixer");
        }}
      />
    </div>
  );
}
