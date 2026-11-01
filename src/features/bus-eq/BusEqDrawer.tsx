/**
 * Bus EQ drawer. Rendered as a Mixer overlay; subscribes to `bus_eq:{j}` only while
 * open. On / A-B memory, then the shared parametric editor (graph + table + Trim/Delay).
 */
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ToggleChip } from "@/components/mixer";
import { Button, Drawer, ErrorState, IconButton, Skeleton, toast } from "@/components/ui";
import { busName, busTitle } from "@/features/mixer/labels";
import { Section, bool, setFx } from "@/features/strip-fx/controls";
import { bridge, errorMessage, type BusEq, type ParamValue } from "@/lib/bridge";
import { bus, isPhysicalBus } from "@/lib/params";
import { useGroup } from "@/stores/groupStore";
import { useMixer, usePendingValue } from "@/stores/mixerStore";
import { BUS_EQ_GROUP, useBusEq } from "./busEqStore";
import { EqEditor } from "./EqEditor";

const WIDTH = 520;

export default function BusEqDrawer() {
  const { open, bus: j, close, step } = useBusEq();
  const b = useMixer((st) => st.state?.buses[j]);
  const title = busTitle(j, b?.label ?? "");
  const kind = isPhysicalBus(j) ? "Physical output" : "Virtual output";

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => !o && close()}
      title={title === busName(j) ? `${title} EQ` : `${busName(j)} · ${title}`}
      description={`${kind} ${busName(j)} · Parametric EQ`}
      width={WIDTH}
      headerActions={
        <>
          <IconButton label="Previous bus" size="sm" icon={<ChevronLeft size={16} strokeWidth={1.5} />} onClick={() => step(-1)} />
          <IconButton label="Next bus" size="sm" icon={<ChevronRight size={16} strokeWidth={1.5} />} onClick={() => step(1)} />
        </>
      }
    >
      {open ? <BusEqBody key={j} index={j} /> : null}
    </Drawer>
  );
}

function BusEqBody({ index }: { index: number }) {
  const id = BUS_EQ_GROUP(index);
  const { data, error, status } = useGroup<BusEq>(id);
  const eqOnCore = useMixer((st) => st.state?.buses[index]?.eqOn);
  const p = useMemo(() => bus(index), [index]);
  const [retrying, setRetrying] = useState(false);
  const name = busName(index);
  const on = eqOnCore ?? data?.on ?? false;
  const ab = Number(usePendingValue<ParamValue>(p.eqAb(), bool(data?.ab ?? false))) >= 0.5;

  const retry = async () => {
    setRetrying(true);
    try {
      await bridge.refreshGroup(id);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRetrying(false);
    }
  };

  if (!data) {
    if (status === "error") {
      return (
        <div className="p-4">
          <ErrorState title={`Couldn't read ${name}'s EQ`} message={error ?? undefined} retry={() => void retry()} />
        </div>
      );
    }
    return <BodySkeleton />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {error ? (
        <div role="status" className="flex items-center gap-2 border-b border-line bg-panel-2 px-4 py-2 text-12 text-text-dim">
          <span className="flex-1">Showing the last values read. {error}</span>
          <Button size="sm" variant="ghost" loading={retrying} onClick={() => void retry()}>
            Try again
          </Button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section
          title="Equalizer"
          actions={
            <div className="flex items-center gap-1">
              <ToggleChip pressed={on} onPressedChange={(v) => setFx(p.eqOn(), bool(v))} label={`${name} EQ ${on ? "on" : "off"}`}>
                {on ? "On" : "Off"}
              </ToggleChip>
              <div role="group" aria-label={`${name} EQ memory`} className="flex gap-0.5">
                <ToggleChip pressed={!ab} onPressedChange={() => setFx(p.eqAb(), 0)} label="EQ memory A" tooltip="EQ memory A">
                  A
                </ToggleChip>
                <ToggleChip pressed={ab} onPressedChange={() => setFx(p.eqAb(), 1)} label="EQ memory B" tooltip="EQ memory B">
                  B
                </ToggleChip>
              </div>
            </div>
          }
        >
          <p className="text-12 text-text-dim">
            {on ? "EQ is on." : "EQ is off. Edits are kept and apply once it's on."} Memory {ab ? "B" : "A"} is active.
            {data.sampleRate ? ` Curve drawn at ${(data.sampleRate / 1000).toFixed(1)} kHz.` : ""}
          </p>
        </Section>
        <EqEditor
          id={`bus:${index}`}
          label={`${name} EQ`}
          cellName={p.eqCell}
          channels={data.channels}
          channelParams={{ trim: p.eqTrim, delay: p.eqDelay }}
          sampleRate={data.sampleRate}
          bypassed={!on}
        />
      </div>
    </div>
  );
}

function BodySkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading EQ" className="flex flex-col gap-4 p-4">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-[220px] w-full" />
      {Array.from({ length: 6 }, (_, k) => (
        <Skeleton key={k} className="h-7 w-full" />
      ))}
    </div>
  );
}
