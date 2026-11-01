/**
 * EQ tab: on / A-B memory, the virtual strips' 3-band EQ (`EQGain1..3`), and the 6-band
 * parametric EQ. Every strip has the parametric EQ on 8 channels (verified on Potato 3.1.3.0).
 * The parametric EQ is the shared graph editor (`features/bus-eq/EqEditor`):
 * linked across all 8 channels by default, or one channel.
 */
import { useMemo } from "react";
import { ToggleChip } from "@/components/mixer";
import type { ParamValue, StripEq } from "@/lib/bridge";
import { strip } from "@/lib/params";
import { VIRTUAL_EQ_CAPTIONS } from "@/features/mixer/labels";
import { EqEditor } from "@/features/bus-eq/EqEditor";
import { usePendingValue } from "@/stores/mixerStore";
import { FxKnob, KnobRow, Section, bool, setFx } from "./controls";
import { EQ_GAIN } from "./fxSpec";

export function EqPanel({
  index,
  name,
  eq,
  virtualGains,
}: {
  index: number;
  name: string;
  eq: StripEq;
  /** `EQGain1..3` from `core` (virtual strips only). */
  virtualGains: readonly number[] | null;
}) {
  const p = useMemo(() => strip(index), [index]);
  const on = Number(usePendingValue<ParamValue>(p.eqOn(), bool(eq.on))) >= 0.5;
  const ab = Number(usePendingValue<ParamValue>(p.eqAb(), bool(eq.ab))) >= 0.5;

  return (
    <>
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
        </p>
      </Section>

      {virtualGains ? (
        <Section
          title="3-band EQ"
          reset={{
            description: "Sets all three bands back to 0 dB.",
            edits: () => ([1, 2, 3] as const).map((n) => [p.eqGain(n), EQ_GAIN.def] as const),
          }}
        >
          <KnobRow>
            {([1, 2, 3] as const).map((n) => {
              const caption = VIRTUAL_EQ_CAPTIONS[n - 1] ?? `EQ ${n}`;
              return (
                <FxKnob
                  key={n}
                  param={p.eqGain(n)}
                  value={virtualGains[n - 1] ?? 0}
                  spec={{ ...EQ_GAIN, label: caption }}
                  label={`${name} ${caption}`}
                />
              );
            })}
          </KnobRow>
        </Section>
      ) : null}

      <EqEditor id={`strip:${index}`} label={`${name} EQ`} cellName={p.eqCell} channels={eq.channels} bypassed={!on} />
    </>
  );
}
