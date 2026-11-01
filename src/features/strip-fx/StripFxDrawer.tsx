/**
 * Strip FX drawer. Rendered as a Mixer overlay; subscribes to `strip_fx:{i}` only while
 * open. Hardware strips get EQ / Comp / Gate tabs; virtual strips (no dynamics in Voicemeeter)
 * get the EQ only. Limit is on every strip, Denoiser on hardware strips.
 */
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, Drawer, ErrorState, IconButton, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger, toast } from "@/components/ui";
import type { StripFxTab } from "@/features/mixer/extensions";
import { stripDefaultName, stripName } from "@/features/mixer/labels";
import { bridge, errorMessage, type StripFx } from "@/lib/bridge";
import { strip } from "@/lib/params";
import { useGroup } from "@/stores/groupStore";
import { useMixer } from "@/stores/mixerStore";
import { FxKnob, KnobRow, Section } from "./controls";
import { CompPanel, GatePanel } from "./DynamicsPanels";
import { EqPanel } from "./EqPanel";
import { AMOUNT, LIMIT } from "./fxSpec";
import { STRIP_FX_GROUP, useStripFx } from "./stripFxStore";

const WIDTH = 460;

export default function StripFxDrawer() {
  const { open, strip: i, close, step } = useStripFx();
  const s = useMixer((st) => st.state?.strips[i]);
  const name = s ? stripName(i, s.label) : stripDefaultName(i);
  const kind = s?.kind === "virtual" ? "Virtual input" : "Hardware input";

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => !o && close()}
      title={name}
      description={`${kind} ${i + 1} · Effects`}
      width={WIDTH}
      headerActions={
        <>
          <IconButton
            label="Previous strip"
            size="sm"
            icon={<ChevronLeft size={16} strokeWidth={1.5} />}
            onClick={() => step(-1)}
          />
          <IconButton label="Next strip" size="sm" icon={<ChevronRight size={16} strokeWidth={1.5} />} onClick={() => step(1)} />
        </>
      }
    >
      {open ? <StripFxBody key={i} index={i} name={name} /> : null}
    </Drawer>
  );
}

function StripFxBody({ index, name }: { index: number; name: string }) {
  const id = STRIP_FX_GROUP(index);
  const { data, error, status } = useGroup<StripFx>(id);
  const s = useMixer((st) => st.state?.strips[index]);
  const { tab, setTab } = useStripFx();
  const [retrying, setRetrying] = useState(false);

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

  if (!data || !s) {
    if (status === "error") {
      return (
        <div className="p-4">
          <ErrorState title="Couldn't read this strip's effects" message={error ?? undefined} retry={() => void retry()} />
        </div>
      );
    }
    return <BodySkeleton />;
  }

  const p = strip(index);
  const hw = data.kind === "hardware";
  const quick = s.quick;
  const activeTab: StripFxTab = hw ? tab : "eq";

  const eq = (
    <EqPanel
      index={index}
      name={name}
      eq={data.eq}
      virtualGains={quick.kind === "virtual" ? quick.eqGain : null}
    />
  );

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

      <Section
        title="Strip"
        reset={{
          description: hw ? "Turns the limiter off (+12 dB) and the denoiser to 0." : "Turns the limiter off (+12 dB).",
          edits: () => (hw ? [[p.limit(), LIMIT.def], [p.denoiser(), AMOUNT.def]] : [[p.limit(), LIMIT.def]]),
        }}
      >
        <KnobRow>
          <FxKnob param={p.limit()} value={data.limit} spec={LIMIT} label={`${name} limiter`} />
          {hw && quick.kind === "hardware" ? (
            <FxKnob param={p.denoiser()} value={quick.denoiser} spec={{ ...AMOUNT, label: "Denoiser" }} label={`${name} denoiser`} />
          ) : null}
        </KnobRow>
      </Section>

      {hw && data.comp && data.gate && quick.kind === "hardware" ? (
        <Tabs value={activeTab} onValueChange={(v) => setTab(v as StripFxTab)} className="flex min-h-0 flex-1 flex-col">
          <div className="px-4 pt-3">
            <TabsList aria-label={`${name} effect`}>
              <TabsTrigger value="eq">EQ</TabsTrigger>
              <TabsTrigger value="comp">Comp</TabsTrigger>
              <TabsTrigger value="gate">Gate</TabsTrigger>
            </TabsList>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <TabsContent value="eq" className="mt-0">
              {eq}
            </TabsContent>
            <TabsContent value="comp" className="mt-0">
              <CompPanel index={index} name={name} amount={quick.comp} data={data.comp} />
            </TabsContent>
            <TabsContent value="gate" className="mt-0">
              <GatePanel index={index} name={name} amount={quick.gate} data={data.gate} />
            </TabsContent>
          </div>
        </Tabs>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {eq}
          <p className="px-4 pb-4 text-12 text-text-faint">
            Virtual inputs have no compressor, gate or denoiser in Voicemeeter.
          </p>
        </div>
      )}
    </div>
  );
}

function BodySkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading effects" className="flex flex-col gap-4 p-4">
      <Skeleton className="h-4 w-24" />
      <div className="flex gap-4">
        <Skeleton className="size-12 rounded-full" />
        <Skeleton className="size-12 rounded-full" />
      </div>
      <Skeleton className="h-8 w-48" />
      {Array.from({ length: 6 }, (_, k) => (
        <Skeleton key={k} className="h-7 w-full" />
      ))}
    </div>
  );
}
