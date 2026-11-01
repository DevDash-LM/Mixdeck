/**
 * Typed bridge to the Rust side. Every `invoke`/`listen` in the app goes through here.
 * Types under ./generated are produced by ts-rs (`cargo test`); never hand-edit them.
 */
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Settings } from "./generated/Settings";
import type { SettingsPatch } from "./generated/SettingsPatch";
import type { ConnectionState } from "./generated/ConnectionState";
import type { EngineInfo } from "./generated/EngineInfo";
import type { FakeEvent } from "./generated/FakeEvent";
import type { GroupEvent } from "./generated/GroupEvent";
import type { Levels } from "./generated/Levels";
import type { MixerState } from "./generated/MixerState";
import type { ParamValue } from "./generated/ParamValue";
import type { PresetSummary } from "./generated/PresetSummary";
import type { LoadReport } from "./generated/LoadReport";
import type { HotkeyStatus } from "./generated/HotkeyStatus";
import type { Notice } from "./generated/Notice";
import type { AboutInfo } from "./generated/AboutInfo";
import type { SessionsState } from "./generated/SessionsState";
import type { AppLevels } from "./generated/AppLevels";
import type { SoundSettingsPage } from "./generated/SoundSettingsPage";
import type { SessionsFakeEvent } from "./generated/SessionsFakeEvent";

export type { Settings, SettingsPatch };
export type { Hotkey } from "./generated/Hotkey";
export type { ConnectionState, EngineInfo, FakeEvent, GroupEvent, Levels, MixerState, ParamValue };
export type { Strip } from "./generated/Strip";
export type { Bus } from "./generated/Bus";
export type { BusMode } from "./generated/BusMode";
export type { StripQuick } from "./generated/StripQuick";
export type { VmEdition } from "./generated/VmEdition";
export type { BackendKind } from "./generated/BackendKind";
export type { DeviceList } from "./generated/DeviceList";
export type { Device } from "./generated/Device";
export type { DeviceDriver } from "./generated/DeviceDriver";
export type { StripFx } from "./generated/StripFx";
export type { Comp } from "./generated/Comp";
export type { Gate } from "./generated/Gate";
export type { StripEq } from "./generated/StripEq";
export type { StripEqChannel } from "./generated/StripEqChannel";
export type { EqCell } from "./generated/EqCell";
export type { StripKind } from "./generated/StripKind";
export type { BusEq } from "./generated/BusEq";
export type { BusEqChannel } from "./generated/BusEqChannel";
export type { BusKind } from "./generated/BusKind";
export type { Preset } from "./generated/Preset";
export type { PresetSummary } from "./generated/PresetSummary";
export type { LoadReport } from "./generated/LoadReport";
export type { HotkeyAction } from "./generated/HotkeyAction";
export type { HotkeyStatus } from "./generated/HotkeyStatus";
export type { HotkeyRegState } from "./generated/HotkeyRegState";
export type { Target } from "./generated/Target";
export type { TargetKind } from "./generated/TargetKind";
export type { Notice } from "./generated/Notice";
export type { NoticeKind } from "./generated/NoticeKind";
export type { AboutInfo } from "./generated/AboutInfo";
export type { SessionsState, AppLevels, SoundSettingsPage, SessionsFakeEvent };
export type { AppSession } from "./generated/AppSession";
export type { EndpointApps } from "./generated/EndpointApps";
export type { SessionTarget } from "./generated/SessionTarget";
export type { SessionTargetKind } from "./generated/SessionTargetKind";
export type { SessionsStatus } from "./generated/SessionsStatus";
export type { AppsSettings } from "./generated/AppsSettings";
export type { EndpointRule } from "./generated/EndpointRule";

/** True when running inside the Tauri webview (false in a plain browser tab). */
export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Normalises a rejected command into a user-readable message. */
export function errorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

export const bridge = {
  /** Tell Rust the first frame is painted so it can show the window. */
  appReady: (): Promise<void> => invoke("app_ready"),
  getSettings: (): Promise<Settings> => invoke<Settings>("get_settings"),
  setSettings: (patch: SettingsPatch): Promise<Settings> =>
    invoke<Settings>("set_settings", { patch }),

  // ---- Engine. Prefer `useMixer().setParam` in views: it adds optimistic updates. ----
  /** Writes one parameter. Build `name` with `@/lib/params`. Bools are 0/1. */
  setParam: (name: string, value: ParamValue): Promise<void> => invoke("set_param", { name, value }),
  /** Applies a script atomically (≤ 48 kB; use `ScriptBuilder.chunks()`). */
  setScript: (script: string): Promise<void> => invoke("set_script", { script }),
  getState: (): Promise<MixerState> => invoke<MixerState>("get_state"),
  /** Prefer `useGroup(id)`, which ref-counts subscriptions. */
  subscribeGroup: (id: string): Promise<void> => invoke("subscribe_group", { id }),
  unsubscribeGroup: (id: string): Promise<void> => invoke("unsubscribe_group", { id }),
  /** Re-reads a subscribed group now. Resolves once read; data arrives on `mixer://group`. */
  refreshGroup: (id: string): Promise<void> => invoke("refresh_group", { id }),
  /** Streams levels (~60/s) to `onLevels`. A new call replaces the previous stream. */
  startLevels: (onLevels: (l: Levels) => void): Promise<void> => {
    const channel = new Channel<Levels>();
    channel.onmessage = onLevels;
    return invoke("start_levels", { channel });
  },
  launchVoicemeeter: (): Promise<void> => invoke("launch_voicemeeter"),
  restartAudioEngine: (): Promise<void> => invoke("restart_audio_engine"),
  retryConnection: (): Promise<void> => invoke("retry_connection"),
  getEngineInfo: (): Promise<EngineInfo> => invoke<EngineInfo>("get_engine_info"),
  /** Switch to/from the simulated engine (not persisted). */
  setDemoMode: (enabled: boolean): Promise<EngineInfo> =>
    invoke<EngineInfo>("set_demo_mode", { enabled }),
  /** Demo mode only. */
  simulate: (event: FakeEvent): Promise<void> => invoke("simulate", { event }),

  // ---- Presets ----
  listPresets: (): Promise<PresetSummary[]> => invoke<PresetSummary[]>("list_presets"),
  /** `groups`: "core", "strip_fx:{i}", "bus_eq:{j}". Same name without `overwrite` is an error. */
  savePreset: (name: string, groups: string[], overwrite = false): Promise<PresetSummary> =>
    invoke<PresetSummary>("save_preset", { name, groups, overwrite }),
  loadPreset: (id: string): Promise<LoadReport> => invoke<LoadReport>("load_preset", { id }),
  renamePreset: (id: string, name: string): Promise<PresetSummary> =>
    invoke<PresetSummary>("rename_preset", { id, name }),
  deletePreset: (id: string): Promise<void> => invoke("delete_preset", { id }),
  openPresetsFolder: (): Promise<void> => invoke("open_presets_folder"),
  /** Voicemeeter writes its own XML (`Command.Save`). Resolves with a status message. */
  exportVmXml: (path: string): Promise<string> => invoke<string>("export_vm_xml", { path }),
  importVmXml: (path: string): Promise<void> => invoke("import_vm_xml", { path }),

  // ---- Hotkeys. Bindings are `Settings.hotkeys`; save them with `setSettings`. ----
  getHotkeyStatus: (): Promise<HotkeyStatus[]> => invoke<HotkeyStatus[]>("get_hotkey_status"),
  setHotkeysPaused: (paused: boolean): Promise<HotkeyStatus[]> =>
    invoke<HotkeyStatus[]>("set_hotkeys_paused", { paused }),
  /** Resolves with the canonical form if Windows would accept it; rejects with a reason. */
  checkHotkey: (accelerator: string): Promise<string> => invoke<string>("check_hotkey", { accelerator }),

  // ---- About ----
  getAboutInfo: (): Promise<AboutInfo> => invoke<AboutInfo>("get_about_info"),
  openLogFolder: (): Promise<void> => invoke("open_log_folder"),

  // ---- App sessions. Prefer `useSessions(target)` / `sessionsStore`. ----
  getSessions: (): Promise<SessionsState> => invoke<SessionsState>("get_sessions"),
  /** Windows session volume, 0..1 (same as the Windows volume mixer). */
  setAppVolume: (key: string, v: number): Promise<void> => invoke("set_app_volume", { key, volume: v }),
  setAppMute: (key: string, muted: boolean): Promise<void> => invoke("set_app_mute", { key, muted }),
  /** Streams per-app peaks (~15/s, foreground only). A new call replaces the previous stream. */
  startAppLevels: (onLevels: (l: AppLevels) => void): Promise<void> => {
    const channel = new Channel<AppLevels>();
    channel.onmessage = onLevels;
    return invoke("start_app_levels", { channel });
  },
  /** Scan now (also retries Windows audio after a failure). */
  rescanSessions: (): Promise<void> => invoke("rescan_sessions"),
  openSoundSettings: (page: SoundSettingsPage): Promise<void> => invoke("open_sound_settings", { page }),
  /** Simulated sessions only (`SessionsState.fake`). */
  simulateSessions: (event: SessionsFakeEvent): Promise<void> => invoke("simulate_sessions", { event }),
};

/** App-session events (see src-tauri/src/sessions). */
export const sessionsEvents = {
  /** Emitted only when something changed (`rev` increases). */
  onState: (cb: (s: SessionsState) => void): Promise<UnlistenFn> =>
    listen<SessionsState>("sessions://state", (e) => cb(e.payload)),
};

/** Preset events. */
export const presetEvents = {
  /** The preset list changed (save, rename, delete). Payload: the full new list. */
  onChanged: (cb: (list: PresetSummary[]) => void): Promise<UnlistenFn> =>
    listen<PresetSummary[]>("presets://changed", (e) => cb(e.payload)),
};

/** Toasts raised in Rust (hotkeys, tray preset loads); only sent while the window is visible. */
export const notifyEvents = {
  onToast: (cb: (n: Notice) => void): Promise<UnlistenFn> => listen<Notice>("notify://toast", (e) => cb(e.payload)),
};

/** Engine events (see src-tauri/src/engine). */
export const engineEvents = {
  /** Full Mixer state, emitted when it changes (`rev` increases). */
  onState: (cb: (s: MixerState) => void): Promise<UnlistenFn> =>
    listen<MixerState>("mixer://state", (e) => cb(e.payload)),
  /** Detail group data for subscribed groups. */
  onGroup: (cb: (g: GroupEvent) => void): Promise<UnlistenFn> =>
    listen<GroupEvent>("mixer://group", (e) => cb(e.payload)),
  onConnection: (cb: (c: ConnectionState) => void): Promise<UnlistenFn> =>
    listen<ConnectionState>("mixer://connection", (e) => cb(e.payload)),
};

/** Tray events (see src-tauri/src/tray.rs). */
export const trayEvents = {
  /** Tray asked to show a view (currently only "settings"). */
  onNavigate: (cb: (viewId: string) => void): Promise<UnlistenFn> =>
    listen<string>("tray://navigate", (e) => cb(e.payload)),
  /** Tray item forwarded to the app (e.g. "restart-engine"). */
  onAction: (cb: (actionId: string) => void): Promise<UnlistenFn> =>
    listen<string>("tray://action", (e) => cb(e.payload)),
  /** Tray Presets ▸ item clicked. Rust loads it; don't also load it here. */
  onPreset: (cb: (presetId: string) => void): Promise<UnlistenFn> =>
    listen<string>("tray://preset", (e) => cb(e.payload)),
};
