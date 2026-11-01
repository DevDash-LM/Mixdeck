/**
 * The `devices` group and device selection.
 *
 * The list is subscribed only while a picker is open (so the engine doesn't re-enumerate on
 * every dirty tick), and opening a picker re-reads it, which is how a newly plugged USB device
 * shows up. The last list is cached so a re-opened picker shows it at once while it refreshes.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "@/components/ui";
import { bridge, errorMessage, type Device, type DeviceDriver, type DeviceList } from "@/lib/bridge";
import { bus, strip } from "@/lib/params";
import { useGroup } from "@/stores/groupStore";

export const DEVICES_GROUP = "devices";

/** A hardware strip (0–4) takes an input device; a physical bus A1–A5 (0–4) an output device. */
export interface DeviceTarget {
  kind: "strip" | "bus";
  index: number;
}

export const targetKey = (t: DeviceTarget) => `${t.kind}:${t.index}`;

/** Picker order: WDM first (what most setups should use), ASIO last. */
export const DRIVER_ORDER: readonly DeviceDriver[] = ["wdm", "ks", "mme", "asio"];
export const DRIVER_LABEL: Readonly<Record<DeviceDriver, string>> = {
  wdm: "WDM",
  ks: "Kernel streaming (KS)",
  mme: "MME",
  asio: "ASIO",
};

/** Drivers a target can use. ASIO outputs are A1 only (cheatsheet). ASIO on input strips isn't
 *  offered: the cheatsheet lists `Strip[i].device.asio` but not what value it takes (in
 *  Voicemeeter, inputs pick channels of A1's ASIO device), so we don't guess. */
export function driversFor(t: DeviceTarget): readonly DeviceDriver[] {
  return t.kind === "bus" && t.index === 0 ? DRIVER_ORDER : DRIVER_ORDER.filter((d) => d !== "asio");
}

let cache: DeviceList | null = null;

export interface DeviceListResult {
  /** Fresh data, or the cached list while the first read after opening is in flight. */
  list: DeviceList | null;
  status: "loading" | "ready" | "error";
  error: string | null;
  refreshing: boolean;
  refresh: () => Promise<void>;
}

/** The device list while `active` (a picker is open). */
export function useDeviceList(active: boolean): DeviceListResult {
  const g = useGroup<DeviceList>(active ? DEVICES_GROUP : null);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    if (g.data) cache = g.data;
  }, [g.data]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await bridge.refreshGroup(DEVICES_GROUP);
    } catch (err) {
      toast.error(`Couldn't refresh the device list: ${errorMessage(err)}`);
    } finally {
      setRefreshing(false);
    }
  }, []);

  return { list: g.data ?? cache, status: g.status, error: g.error, refreshing, refresh };
}

/** Driver the user last picked per target, to tell apart WDM/KS/MME entries with the same name
 *  (`device.name` reports only the name). Session-only. */
const lastPick = new Map<string, { driver: DeviceDriver; name: string }>();

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
export const deviceKey = (d: Pick<Device, "driver" | "name">) => `${d.driver}:${d.name}`;

/**
 * The list entry that is the current device: the remembered driver if it still matches, else
 * the first by `DRIVER_ORDER`. `null` = no device; `"missing"` = a device not in the list.
 */
export function findCurrent(t: DeviceTarget, current: string | null, devices: readonly Device[]): Device | null | "missing" {
  if (!current?.trim()) return null;
  const matches = devices.filter((d) => sameName(d.name, current));
  if (!matches.length) return "missing";
  const remembered = lastPick.get(targetKey(t));
  return (
    matches.find((d) => remembered && d.driver === remembered.driver && sameName(d.name, remembered.name)) ??
    [...matches].sort((a, b) => DRIVER_ORDER.indexOf(a.driver) - DRIVER_ORDER.indexOf(b.driver))[0] ??
    "missing"
  );
}

/**
 * Selects `device` on the target (`device.<driver> = name`), or clears it with `null`
 * (`device.wdm = ""`, which the cheatsheet documents as "unselects"). Rejects with a readable
 * message.
 */
export async function selectDevice(t: DeviceTarget, device: Device | null): Promise<void> {
  const p = t.kind === "strip" ? strip(t.index) : bus(t.index);
  try {
    await bridge.setParam(p.device(device?.driver ?? "wdm"), device?.name ?? "");
  } catch (err) {
    throw new Error(errorMessage(err));
  }
  if (device) lastPick.set(targetKey(t), { driver: device.driver, name: device.name });
  else lastPick.delete(targetKey(t));
}
