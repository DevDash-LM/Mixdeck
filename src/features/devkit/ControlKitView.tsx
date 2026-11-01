/**
 * Dev-only control kit: the v2 control props side by side, on local state.
 * Registered in `routes.ts` only when `import.meta.env.DEV`.
 */
import { useState } from "react";
import { Fader, faderInset, Knob, Meter, SectionHeader, ToggleChip } from "@/components/mixer";
import { boostState, formatSignedDb } from "@/lib/db";

export default function ControlKitView() {
  const [v1, setV1] = useState(0);
  const [v2, setV2] = useState(-6);
  const [h1, setH1] = useState(0);
  const [h2, setH2] = useState(3.5);
  const [k, setK] = useState(0);
  const [muted, setMuted] = useState(false);
  const [md, setMd] = useState(false);
  const [lg, setLg] = useState(true);
  const hInset = faderInset({ orientation: "horizontal", valueInCap: true });
  const vInset = faderInset({ valueInCap: true });

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto p-4">
      <SectionHeader
        title="Control kit"
        count="dev"
        action={<span className="text-11 text-text-faint">Drag · wheel · arrows · double-click · Alt-click / Enter</span>}
      />
      <div className="flex min-h-0 flex-wrap gap-8">
        <section className="flex flex-col gap-2">
          <SectionHeader title="Vertical" count={`${formatSignedDb(v1)} · ${formatSignedDb(v2)}`} />
          <div className="flex h-[320px] gap-6">
            <Fader value={v1} onChange={setV1} label="Default fader" meter={<Meter kind="out" bars={[[0], [1]]} label="Bus 1 level" />} />
            <Fader
              value={v2}
              onChange={setV2}
              label="Value-in-cap fader"
              valueInCap
              dimmed={muted}
              scaleLabels
              meter={<Meter kind="out" bars={[[0], [1]]} barWidth={5} inset={vInset} dimmed={muted} label="Bus 1 level" />}
            />
          </div>
        </section>

        <section className="flex w-[340px] flex-col gap-2">
          <SectionHeader title="Horizontal" count={`${formatSignedDb(h1)} · ${formatSignedDb(h2)}`} />
          <Fader value={h1} onChange={setH1} label="Horizontal default fader" orientation="horizontal" />
          <Fader
            value={h2}
            onChange={setH2}
            label="Horizontal value-in-cap fader"
            orientation="horizontal"
            valueInCap
            dimmed={muted}
            scaleLabels={false}
            meter={
              <Meter kind="out" bars={[[0], [1]]} orientation="horizontal" barWidth={3} inset={hInset} dimmed={muted} label="Bus 1 level" />
            }
          />
          <p className="text-11 text-text-faint">
            Boosted: {boostState(h2) ? "yes" : "no"}. Detent holds 0.0 while dragging; Shift-drag passes through.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <SectionHeader title="Knob & chips" />
          <div className="flex items-start gap-4">
            <Knob value={k} onChange={setK} min={-12} max={12} bipolar unit="dB" size={36} label="Treble" caption={<span>Treble</span>} />
            <Knob value={k} onChange={setK} min={-12} max={12} bipolar unit="dB" caption="Old 28" />
          </div>
          <div className="grid w-[160px] grid-cols-2 gap-1.5">
            <ToggleChip size="md" tone="mute" pressed={muted} onPressedChange={setMuted}>
              Mute
            </ToggleChip>
            <ToggleChip size="md" pressed={md} onPressedChange={setMd}>
              Mono
            </ToggleChip>
            <ToggleChip size="lg" pressed={lg} onPressedChange={setLg}>
              EQ
            </ToggleChip>
            <ToggleChip size="sm" pressed={false} onPressedChange={() => undefined}>
              sm 22
            </ToggleChip>
          </div>
        </section>
      </div>
    </div>
  );
}
