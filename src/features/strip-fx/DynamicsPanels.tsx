/** Compressor and Gate tabs (hardware strips only: Voicemeeter drops these on virtual strips). */
import { ToggleChip } from "@/components/mixer";
import type { Comp, Gate, ParamValue } from "@/lib/bridge";
import { strip } from "@/lib/params";
import { usePendingValue } from "@/stores/mixerStore";
import { FxKnob, KnobRow, Section, bool, setFx } from "./controls";
import { AMOUNT, COMP_FIELDS, COMP_MAKEUP_DEFAULT, GATE_FIELDS } from "./fxSpec";

interface PanelProps<T> {
  index: number;
  /** Strip display name, for accessible labels. */
  name: string;
  /** Strip-face amount knob value (from `core`). */
  amount: number;
  data: T;
}

export function CompPanel({ index, name, amount, data }: PanelProps<Comp>) {
  const p = strip(index);
  const makeup = Number(usePendingValue<ParamValue>(p.compMakeup(), bool(data.makeup))) >= 0.5;
  return (
    <>
      <Section
        title="Compressor"
        reset={{
          description: "Sets the amount to 0 and every compressor setting back to Voicemeeter's defaults.",
          edits: () => [
            [p.comp(), AMOUNT.def],
            ...COMP_FIELDS.map((f) => [f.param(p), f.spec.def] as const),
            [p.compMakeup(), bool(COMP_MAKEUP_DEFAULT)],
          ],
        }}
      >
        <KnobRow>
          <FxKnob param={p.comp()} value={amount} spec={{ ...AMOUNT, label: "Amount" }} label={`${name} compressor amount`} />
          {COMP_FIELDS.slice(0, 5).map((f) => (
            <FxKnob key={f.key} param={f.param(p)} value={data[f.key]} spec={f.spec} label={`${name} compressor ${f.spec.label.toLowerCase()}`} />
          ))}
        </KnobRow>
      </Section>
      <Section
        title="Gain staging"
        actions={
          <ToggleChip
            pressed={makeup}
            onPressedChange={(on) => setFx(p.compMakeup(), bool(on))}
            label={`${name} auto make-up gain ${makeup ? "on" : "off"}`}
            tooltip="Automatic make-up gain"
          >
            Auto make-up
          </ToggleChip>
        }
      >
        <KnobRow>
          {COMP_FIELDS.slice(5).map((f) => (
            <FxKnob key={f.key} param={f.param(p)} value={data[f.key]} spec={f.spec} label={`${name} compressor ${f.spec.label.toLowerCase()}`} />
          ))}
        </KnobRow>
      </Section>
    </>
  );
}

export function GatePanel({ index, name, amount, data }: PanelProps<Gate>) {
  const p = strip(index);
  return (
    <Section
      title="Gate"
      reset={{
        description: "Sets the amount to 0 and every gate setting back to Voicemeeter's defaults.",
        edits: () => [[p.gate(), AMOUNT.def], ...GATE_FIELDS.map((f) => [f.param(p), f.spec.def] as const)],
      }}
    >
      <KnobRow>
        <FxKnob param={p.gate()} value={amount} spec={{ ...AMOUNT, label: "Amount" }} label={`${name} gate amount`} />
        {GATE_FIELDS.map((f) => (
          <FxKnob key={f.key} param={f.param(p)} value={data[f.key]} spec={f.spec} label={`${name} gate ${f.spec.label.toLowerCase()}`} />
        ))}
      </KnobRow>
    </Section>
  );
}
