/**
 * Table editor for 6 parametric EQ cells (one row per band). It
 * sits under the EQ graph in `features/bus-eq/EqEditor` (strips and buses) for exact values.
 */
import { NumberField, ToggleChip } from "@/components/mixer";
import { Select } from "@/components/ui";
import type { EqCell } from "@/lib/bridge";
import type { EqField } from "@/lib/params";
import { EQ_TYPE_OPTIONS, eqTypeLabel } from "@/features/bus-eq/eqTypes";
import { CELL_F, CELL_GAIN, CELL_Q } from "./fxSpec";

export interface EqCellTableProps {
  cells: readonly EqCell[];
  onChange: (cell: number, field: EqField, value: number) => void;
  /** Prefix for accessible names ("Mic EQ"). */
  label?: string;
  disabled?: boolean;
}

export function EqCellTable({ cells, onChange, label = "EQ", disabled }: EqCellTableProps) {
  return (
    <div role="table" aria-label={`${label} bands`} className="flex flex-col gap-1">
      <div role="row" className="grid grid-cols-[20px_34px_1fr_76px_60px_52px] items-center gap-1.5 px-1 text-11 text-text-faint">
        <span role="columnheader">#</span>
        <span role="columnheader">On</span>
        <span role="columnheader">Type</span>
        <span role="columnheader" className="text-right">Freq</span>
        <span role="columnheader" className="text-right">Gain</span>
        <span role="columnheader" className="text-right">Q</span>
      </div>
      {cells.map((c, k) => {
        const band = `${label} band ${k + 1}`;
        return (
          <div
            key={k}
            role="row"
            className="grid grid-cols-[20px_34px_1fr_76px_60px_52px] items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-panel-2"
          >
            <span role="cell" className="tabular text-11 text-text-dim">
              {k + 1}
            </span>
            <span role="cell">
              <ToggleChip
                size="xs"
                pressed={c.on}
                disabled={disabled}
                onPressedChange={(on) => onChange(k, "on", on ? 1 : 0)}
                label={`${band} ${c.on ? "on" : "off"}`}
                className="w-full"
              >
                {c.on ? "On" : "Off"}
              </ToggleChip>
            </span>
            <span role="cell" className={c.on ? undefined : "opacity-50"}>
              <Select
                size="sm"
                value={String(c.kind)}
                onValueChange={(v) => onChange(k, "type", Number(v))}
                options={EQ_TYPE_OPTIONS}
                aria-label={`${band} type (${eqTypeLabel(c.kind)})`}
                disabled={disabled}
                className="w-full"
              />
            </span>
            {(
              [
                ["f", c.f, CELL_F, "frequency"],
                ["gain", c.gain, CELL_GAIN, "gain"],
                ["q", c.q, CELL_Q, "Q"],
              ] as const
            ).map(([field, value, spec, what]) => (
              <span role="cell" key={field} className={c.on ? undefined : "opacity-50"}>
                <NumberField
                  value={value}
                  onChange={(v) => onChange(k, field, v)}
                  min={spec.min}
                  max={spec.max}
                  step={spec.step}
                  fineStep={spec.fineStep}
                  format={spec.format}
                  unit={field === "gain" ? "dB" : undefined}
                  label={`${band} ${what}`}
                  disabled={disabled}
                  className="w-full justify-end"
                />
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}
