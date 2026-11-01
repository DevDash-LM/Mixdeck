/**
 * Title-bar connection pill: status at a glance; click opens Connection details with
 * the next action (Retry / Launch / Restart audio engine). Dev builds also get the demo-mode
 * switch and simulated Voicemeeter events.
 */
import { useState, type ReactNode } from "react";
import { Power, RotateCw } from "lucide-react";
import { Button, Popover, PopoverContent, PopoverTrigger, Switch, toast } from "@/components/ui";
import { bridge, errorMessage, type FakeEvent } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { useMixer } from "@/stores/mixerStore";
import { useSessionsStore } from "@/stores/sessionsStore";
import {
  DEMO_AVAILABLE,
  connectionTone,
  editionName,
  longStatus,
  shortStatus,
  useEngineInfo,
  useEngineInfoStore,
} from "./connection";

/** `done`: confirmation toast for events with no immediate on-screen effect. */
const SIMULATIONS: { event: FakeEvent; label: string; done?: string }[] = [
  { event: "externalEdit", label: "External edit" },
  { event: "quit", label: "Quit VM" },
  { event: "start", label: "Start Potato" },
  { event: "startBanana", label: "Start Banana" },
  {
    event: "plugDevice",
    label: "Plug/unplug USB",
    done: "USB Audio Headset plugged in or out. Open a device picker in Routing to see it.",
  },
];

function run(p: Promise<unknown>, done?: string) {
  p.then(() => done && toast.success(done)).catch((err: unknown) => toast.error(errorMessage(err)));
}

function Dot({ tone }: { tone: ReturnType<typeof connectionTone> }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        tone === "ok" && "bg-fg",
        tone === "waiting" && "border border-text-faint",
        tone === "error" && "bg-mute",
      )}
    />
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[72px_1fr] gap-2 text-12">
      <dt className="text-text-faint">{label}</dt>
      <dd className="min-w-0 break-words text-text-dim">{children}</dd>
    </div>
  );
}

export default function ConnectionPill() {
  const connection = useMixer((s) => s.connection);
  const info = useEngineInfo();
  const tone = connectionTone(connection);
  const [open, setOpen] = useState(false);
  const isFake = info?.backend === "fake";
  const connected = connection.status === "connected";
  const fakeSessions = useSessionsStore((s) => s.state?.fake ?? false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Connection: ${shortStatus(connection, info)}. Show details`}
          className={cn(
            "inline-flex h-7 items-center gap-2 rounded-md border border-line px-2.5 text-12 text-text-dim",
            "transition-colors duration-150 ease-out hover:border-line-strong hover:text-text",
            "data-[state=open]:border-line-strong data-[state=open]:text-text",
          )}
        >
          <Dot tone={tone} />
          <span className={cn(connected && !isFake && "tabular")}>{shortStatus(connection, info)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3">
        <div className="flex items-center gap-2">
          <Dot tone={tone} />
          <h2 className="text-13 font-medium text-text">Connection</h2>
        </div>
        <p className="text-12 text-text-dim">{longStatus(connection)}</p>
        <dl className="flex flex-col gap-1.5">
          <Row label="Engine">{isFake ? "Demo (simulated)" : "Voicemeeter"}</Row>
          {connection.status === "connected" || connection.status === "wrongEdition" ? (
            <Row label="Edition">{editionName(connection.vmType)}</Row>
          ) : null}
          {connection.status === "connected" ? (
            <Row label="Version">
              <span className="tabular">{connection.version}</span>
            </Row>
          ) : null}
          {info?.dllPath ? (
            <Row label="DLL">
              <span className="tabular text-11 break-all select-text">{info.dllPath}</span>
            </Row>
          ) : null}
        </dl>

        <div className="flex flex-wrap gap-2">
          {connected ? (
            <Button size="sm" onClick={() => run(bridge.restartAudioEngine(), "Audio engine restarted")} icon={<RotateCw size={14} strokeWidth={1.5} />}>
              Restart audio engine
            </Button>
          ) : (
            <>
              {connection.status === "notRunning" ? (
                <Button size="sm" variant="primary" onClick={() => run(bridge.launchVoicemeeter())} icon={<Power size={14} strokeWidth={1.5} />}>
                  Launch Voicemeeter
                </Button>
              ) : null}
              <Button size="sm" onClick={() => run(bridge.retryConnection())} icon={<RotateCw size={14} strokeWidth={1.5} />}>
                Retry now
              </Button>
            </>
          )}
        </div>

        {DEMO_AVAILABLE ? (
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <Switch
              checked={isFake}
              disabled={!info || info.forcedByEnv}
              onCheckedChange={(on) => run(useEngineInfoStore.getState().setDemo(on))}
              label="Demo mode"
              description={info?.forcedByEnv ? "Forced by MIXDECK_FAKE" : "Simulated engine, dev builds only"}
            />
            {isFake ? (
              <div className="flex flex-wrap gap-1">
                {SIMULATIONS.map((s) => (
                  <Button key={s.event} size="sm" variant="ghost" onClick={() => run(bridge.simulate(s.event), s.done)}>
                    {s.label}
                  </Button>
                ))}
              </div>
            ) : null}
            {fakeSessions ? (
              <div className="flex flex-wrap gap-1">
                <Button size="sm" variant="ghost" onClick={() => run(bridge.simulateSessions("addApp"))}>
                  Add app
                </Button>
                <Button size="sm" variant="ghost" onClick={() => run(bridge.simulateSessions("removeApp"))}>
                  Remove app
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
