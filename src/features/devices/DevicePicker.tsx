/**
 * Device picker: `<DevicePicker target={{ kind: "strip" | "bus", index }} />`.
 * A device chip that opens a menu of the devices Voicemeeter can use, grouped by driver, with
 * "None", the current device checked, and a Refresh item. Opening it re-reads the list.
 * Keyboard: Enter/Space/↓ opens; arrows and type-ahead move; Enter picks; Esc closes.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, RefreshCw } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
  Spinner,
  toast,
} from "@/components/ui";
import type { Device } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { busName, stripDefaultName } from "@/features/mixer/labels";
import { useMixer } from "@/stores/mixerStore";
import {
  DRIVER_LABEL,
  deviceKey,
  driversFor,
  findCurrent,
  selectDevice,
  useDeviceList,
  type DeviceTarget,
} from "./useDevices";

export interface DevicePickerProps {
  target: DeviceTarget;
  /** Current device name; read from the mixer state when omitted. */
  current?: string | null;
  /** "chip" (default, 22px: driver tag + name) or "card" (50px, 2-line name, driver tag). */
  variant?: "chip" | "card";
  className?: string;
}

const NONE = "none";
const MISSING = "missing";
/** How long a picked name is shown before Voicemeeter's `device.name` confirms it. */
const PENDING_MS = 2500;
/** Compact driver tag for the card variant. */
const SHORT_DRIVER = { wdm: "WDM", ks: "KS", mme: "MME", asio: "ASIO" } as const;

export function DevicePicker({ target, current: currentProp, variant = "chip", className }: DevicePickerProps) {
  const fromState = useMixer((s) =>
    target.kind === "strip" ? s.state?.strips[target.index]?.device : s.state?.buses[target.index]?.device,
  );
  const current = currentProp !== undefined ? currentProp : (fromState ?? null);
  const [open, setOpen] = useState(false);
  const { list, status, error, refreshing, refresh } = useDeviceList(open);
  const [pending, setPending] = useState<{ name: string | null } | null>(null);

  // Drop the optimistic name once Voicemeeter reports a change, or after a timeout.
  useEffect(() => setPending(null), [current]);
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(null), PENDING_MS);
    return () => clearTimeout(t);
  }, [pending]);

  const shown = pending ? pending.name : current;
  const isInput = target.kind === "strip";
  const owner = isInput ? stripDefaultName(target.index) : busName(target.index);
  const drivers = useMemo(() => driversFor({ kind: target.kind, index: target.index }), [target.kind, target.index]);
  const devices = useMemo(
    () => (list ? (isInput ? list.inputs : list.outputs).filter((d) => drivers.includes(d.driver)) : []),
    [list, isInput, drivers],
  );
  const match = findCurrent(target, shown, devices);
  const value = match === null ? NONE : match === MISSING ? MISSING : deviceKey(match);
  const byDriver = drivers
    .map((driver) => ({ driver, items: devices.filter((d) => d.driver === driver) }))
    .filter((g) => g.items.length > 0);

  const pick = (key: string) => {
    if (key === value || key === MISSING) return;
    const device: Device | null = key === NONE ? null : (devices.find((d) => deviceKey(d) === key) ?? null);
    if (key !== NONE && !device) return;
    setPending({ name: device?.name ?? null });
    selectDevice(target, device).catch((err: unknown) => {
      setPending(null);
      toast.error(`Couldn't switch ${owner}'s device: ${err instanceof Error ? err.message : String(err)}`);
    });
  };

  const name = shown?.trim() || "No device";
  const busy = pending !== null;
  const tagged = match !== null && match !== MISSING;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        {variant === "card" ? (
          <button
            type="button"
            aria-label={`${owner} ${isInput ? "input" : "output"} device: ${name}. Change device`}
            title={name}
            className={cn(
              "relative flex h-[50px] w-full min-w-0 flex-col justify-between rounded-md border border-line bg-panel-2 py-1.5 pr-1 pl-2 text-left",
              "transition-colors duration-120 ease-out hover:border-line-strong data-[state=open]:border-line-strong",
              className,
            )}
          >
            {/* With a driver tag the name gets one line; without, two (chevron sits in the bottom corner). */}
            <span
              className={cn(
                "text-12 leading-[14px] break-words",
                tagged ? "truncate" : "line-clamp-2",
                shown ? "text-text" : "text-text-faint",
              )}
            >
              {shown?.trim() || "Select device…"}
            </span>
            {tagged ? (
              <span className="tabular w-fit rounded-sm border border-line-strong px-1 text-[10px] leading-[14px] text-text-dim">
                {SHORT_DRIVER[match.driver]}
              </span>
            ) : null}
            <span className="absolute right-1 bottom-1.5">
              {busy ? (
                <Spinner size={11} className="text-text-faint" />
              ) : (
                <ChevronDown size={12} strokeWidth={1.5} className="text-text-faint" aria-hidden />
              )}
            </span>
          </button>
        ) : (
        <button
          type="button"
          aria-label={`${owner} ${isInput ? "input" : "output"} device: ${name}. Change device`}
          title={name}
          className={cn(
            "flex h-[22px] w-full min-w-0 items-center gap-1 rounded-md border border-line bg-panel-2 pr-1 pl-1.5 text-left text-11",
            "transition-colors duration-120 ease-out hover:border-line-strong hover:text-text data-[state=open]:border-line-strong",
            shown ? "text-text-dim" : "text-text-faint",
            className,
          )}
        >
          {tagged ? (
            <span className="tabular shrink-0 rounded-sm border border-line-strong px-1 text-[10px] leading-[14px] text-text-dim">
              {SHORT_DRIVER[match.driver]}
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate">{name}</span>
          {busy ? (
            <Spinner size={11} className="text-text-faint" />
          ) : (
            <ChevronDown size={12} strokeWidth={1.5} className="shrink-0 text-text-faint" aria-hidden />
          )}
        </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-80 max-w-[calc(100vw-16px)] overflow-y-auto"
        style={{ maxHeight: "min(440px, var(--radix-dropdown-menu-content-available-height))" }}
      >
        <div className="flex items-center justify-between gap-2 pr-1">
          <DropdownMenuLabel>
            {owner} · {isInput ? "input device" : "output device"}
          </DropdownMenuLabel>
          {refreshing || (status === "loading" && list) ? <Spinner size={12} className="text-text-faint" label="Refreshing devices" /> : null}
        </div>

        {match === MISSING && shown ? (
          <DropdownMenuItem disabled icon={<AlertTriangle size={14} strokeWidth={1.5} />}>
            <span title={shown}>{shown} (not available)</span>
          </DropdownMenuItem>
        ) : null}

        <DropdownMenuRadioGroup value={value} onValueChange={pick}>
          <DropdownMenuRadioItem value={NONE}>
            <span className="flex-1">None</span>
            <span className="text-11 text-text-faint">no device</span>
          </DropdownMenuRadioItem>

          {!list && status === "loading" ? (
            <div aria-busy aria-label="Loading devices" className="flex flex-col gap-1 px-2 py-1.5">
              <Skeleton className="h-5" />
              <Skeleton className="h-5" />
              <Skeleton className="h-5 w-2/3" />
            </div>
          ) : null}

          {byDriver.map(({ driver, items }) => (
            <DropdownMenuGroup key={driver}>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{DRIVER_LABEL[driver]}</DropdownMenuLabel>
              {items.map((d) => (
                <DropdownMenuRadioItem key={deviceKey(d)} value={deviceKey(d)} textValue={d.name} title={d.name}>
                  <span className="min-w-0 flex-1 truncate">{d.name}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuGroup>
          ))}
        </DropdownMenuRadioGroup>

        {list && byDriver.length === 0 ? (
          <p className="px-2 py-2 text-12 text-text-dim">
            No {isInput ? "input" : "output"} devices found. Plug one in, then refresh.
          </p>
        ) : null}
        {status === "error" && error ? (
          <p role="alert" className="px-2 py-2 text-12 text-mute">
            Couldn't read the device list: {error}
          </p>
        ) : null}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          icon={<RefreshCw size={14} strokeWidth={1.5} />}
          disabled={refreshing}
          onSelect={(e) => {
            e.preventDefault(); // keep the menu open
            void refresh();
          }}
        >
          {status === "error" ? "Try again" : "Refresh list"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Adapters for the Mixer's `registerDevicePicker` slot (`{ index, current }`). */
type AdapterProps = { index: number; current: string | null; variant?: "chip" | "card" };

export function StripDevicePicker({ index, current, variant }: AdapterProps) {
  return <DevicePicker target={{ kind: "strip", index }} current={current} variant={variant} />;
}

export function BusDevicePicker({ index, current, variant }: AdapterProps) {
  return <DevicePicker target={{ kind: "bus", index }} current={current} variant={variant} />;
}
