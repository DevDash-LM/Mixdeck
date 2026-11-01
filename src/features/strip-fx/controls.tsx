/** Building blocks shared by the Strip FX panels: a labelled knob, a section with reset, writers. */
import { useState, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { Knob } from "@/components/mixer";
import { ConfirmDialog, IconButton, toast } from "@/components/ui";
import type { ParamValue } from "@/lib/bridge";
import { useMixer, usePendingValue } from "@/stores/mixerStore";
import type { FxSpec } from "./fxSpec";

/** Optimistic, throttled single write (same path as the Mixer). */
export const setFx = (name: string, value: ParamValue) => useMixer.getState().setParam(name, value);
export const bool = (b: boolean) => (b ? 1 : 0);

/** A knob with its name above and its value (with unit) below. */
export function FxKnob({
  param,
  value,
  spec,
  label,
  onContextMenu,
}: {
  param: string;
  /** Backend value; a pending local edit wins while it's live. */
  value: number;
  spec: Omit<FxSpec, "label"> & { label?: string };
  /** Accessible name, e.g. "Mic compressor threshold". */
  label: string;
  onContextMenu?: () => void;
}) {
  const v = Number(usePendingValue<ParamValue>(param, value));
  return (
    <div className="flex w-[76px] flex-col items-center gap-1">
      {spec.label ? <span className="text-11 leading-4 text-text-dim">{spec.label}</span> : null}
      <Knob
        value={v}
        onChange={(x) => setFx(param, x)}
        min={spec.min}
        max={spec.max}
        defaultValue={spec.def}
        caption={spec.format(v)}
        label={label}
        format={spec.format}
        bipolar={spec.bipolar}
        step={spec.step}
        fineStep={spec.fineStep}
        size={36}
        onContextMenu={onContextMenu}
      />
    </div>
  );
}

/** A titled block with an optional reset (confirmed, then one atomic write). */
export function Section({
  title,
  actions,
  reset,
  children,
}: {
  title: string;
  actions?: ReactNode;
  reset?: {
    /** What the confirm dialog says will happen. */
    description: string;
    edits: () => ReadonlyArray<readonly [string, ParamValue]>;
  };
  children: ReactNode;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <section aria-label={title} className="flex flex-col gap-3 border-b border-line px-4 py-4 last:border-b-0">
      <header className="flex h-6 items-center gap-2">
        <h3 className="flex-1 text-12 font-medium text-text">{title}</h3>
        {actions}
        {reset ? (
          <IconButton label={`Reset ${title.toLowerCase()}`} icon={<RotateCcw size={14} strokeWidth={1.5} />} size="sm" onClick={() => setConfirm(true)} />
        ) : null}
      </header>
      {children}
      {reset ? (
        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          title={`Reset ${title.toLowerCase()}?`}
          description={reset.description}
          confirmLabel="Reset"
          destructive
          onConfirm={async () => {
            if (await useMixer.getState().setParams(reset.edits())) toast.success(`${title} reset`);
          }}
        />
      ) : null}
    </section>
  );
}

export function KnobRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fill,76px)] justify-between gap-x-2 gap-y-4">{children}</div>;
}
