/**
 * Routing: a grid view of the route buttons that are on every strip.
 * Cells toggle in place; bulk row/column actions are confirmed; headers lead to Strip FX /
 * Bus EQ; "Back to Mixer" and "Save preset" are always there (no dead ends).
 */
import { useCallback, useMemo, useState } from "react";
import { ArrowLeft, Save } from "lucide-react";
import { ConnectionGate } from "@/features/connection/ConnectionGate";
import { getMixerActions } from "@/features/mixer/extensions";
import { busName, busTitle, stripDefaultName } from "@/features/mixer/labels";
import { Button, ConfirmDialog, Kbd, Skeleton, Tooltip, toast } from "@/components/ui";
import { BUSES, STRIPS, strip as stripParams } from "@/lib/params";
import { useMixer } from "@/stores/mixerStore";
import { useNavigation } from "@/stores/navigationStore";
import { RoutingGrid, type BulkRequest, type RouteChange } from "./RoutingGrid";
import { useRouting } from "./routingStore";

export default function RoutingView() {
  return (
    <ConnectionGate fallback={<RoutingSkeleton />}>
      <RoutingPage />
    </ConnectionGate>
  );
}

interface PendingBulk {
  title: string;
  description: string;
  confirmLabel: string;
  destructive: boolean;
  changes: RouteChange[];
  /** Success toast. */
  done: string;
}

function RoutingPage() {
  const state = useMixer((s) => s.state);
  const setParams = useMixer((s) => s.setParams);
  const highlight = useRouting((s) => s.highlight);
  const clearHighlight = useRouting((s) => s.clearHighlight);
  const navigate = useNavigation((s) => s.navigate);
  const [bulk, setBulk] = useState<PendingBulk | null>(null);
  const actions = getMixerActions();

  const apply = useCallback(
    (changes: RouteChange[]) =>
      setParams(changes.map((c) => [stripParams(c.strip).route(c.bus), c.on ? 1 : 0] as const)),
    [setParams],
  );
  const commit = useCallback((changes: RouteChange[]) => void apply(changes), [apply]);

  const onBulk = useCallback(
    (req: BulkRequest) => {
      if (!state) return;
      const cells =
        req.kind === "row"
          ? Array.from({ length: BUSES }, (_, j) => ({ strip: req.index, bus: j }))
          : Array.from({ length: STRIPS }, (_, i) => ({ strip: i, bus: req.index }));
      const changes = cells
        .filter((c) => (state.strips[c.strip]?.routes[c.bus] ?? false) !== req.on)
        .map((c) => ({ ...c, on: req.on }));
      if (!changes.length) return;
      const n = changes.length;
      if (req.kind === "row") {
        const s = state.strips[req.index];
        const name = s?.label.trim() || stripDefaultName(req.index);
        setBulk({
          title: req.on ? `Route ${name} to every bus?` : `Clear routing for ${name}?`,
          description: req.on
            ? `${name} will also feed ${n} more bus${n === 1 ? "" : "es"}.`
            : `${name} will stop feeding ${n} bus${n === 1 ? "" : "es"}, so it won't be heard on them.`,
          confirmLabel: req.on ? "Route to all" : "Clear row",
          destructive: !req.on,
          changes,
          done: req.on ? `${name} now feeds every bus` : `${name}'s routing cleared`,
        });
      } else {
        const b = state.buses[req.index];
        const name = b ? busTitle(req.index, b.label) : busName(req.index);
        setBulk({
          title: req.on ? `Route every input to ${name}?` : `Clear everything routed to ${name}?`,
          description: req.on
            ? `${n} more input${n === 1 ? "" : "s"} will play on ${name}.`
            : `${n} input${n === 1 ? "" : "s"} will stop playing on ${name}.`,
          confirmLabel: req.on ? "Route all" : "Clear column",
          destructive: !req.on,
          changes,
          done: req.on ? `Every input now plays on ${name}` : `Nothing is routed to ${name} now`,
        });
      }
    },
    [state],
  );

  // Drawers for Strip FX / Bus EQ live on the Mixer page: go there, then open them.
  const openFx = useMemo(() => {
    const open = actions.openStripFx;
    return open
      ? (i: number) => {
          navigate("mixer");
          open(i);
        }
      : undefined;
  }, [actions.openStripFx, navigate]);
  const openEq = useMemo(() => {
    const open = actions.openBusEq;
    return open
      ? (j: number) => {
          navigate("mixer");
          open(j);
        }
      : undefined;
  }, [actions.openBusEq, navigate]);

  if (!state) return null;
  const routed = state.strips.reduce((n, s) => n + s.routes.filter(Boolean).length, 0);

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex w-max min-w-full flex-col gap-5 px-6 py-5">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-16 font-medium text-text">Routing</h1>
            <p className="max-w-[60ch] text-13 text-text-dim">
              Which inputs feed which buses. Click a cell, or press and drag across cells to set them all the same
              way. {routed === 0 ? "Nothing is routed yet, so no input is heard anywhere." : null}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {actions.savePreset ? (
              <Button variant="ghost" size="sm" icon={<Save size={14} strokeWidth={1.5} />} onClick={actions.savePreset}>
                Save preset
              </Button>
            ) : (
              <Tooltip content="Presets are coming soon">
                <span>
                  <Button variant="ghost" size="sm" disabled icon={<Save size={14} strokeWidth={1.5} />}>
                    Save preset
                  </Button>
                </span>
              </Tooltip>
            )}
            <Button
              variant="secondary"
              size="sm"
              icon={<ArrowLeft size={14} strokeWidth={1.5} />}
              onClick={() => navigate("mixer")}
            >
              Back to Mixer
            </Button>
          </div>
        </header>

        <div className="flex justify-center">
          <RoutingGrid
            strips={state.strips}
            buses={state.buses}
            highlight={highlight}
            onHighlightDone={clearHighlight}
            onCommit={commit}
            onBulk={onBulk}
            onOpenFx={openFx}
            onOpenEq={openEq}
          />
        </div>

        <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-11 text-text-faint">
          <span>
            <Kbd>←</Kbd> <Kbd>→</Kbd> <Kbd>↑</Kbd> <Kbd>↓</Kbd> move
          </span>
          <span>
            <Kbd>Space</Kbd> toggle
          </span>
          <span>
            <Kbd>Esc</Kbd> cancel a drag
          </span>
          <span>Row and column headers have bulk actions</span>
        </p>
      </div>

      <ConfirmDialog
        open={bulk !== null}
        onOpenChange={(open) => !open && setBulk(null)}
        title={bulk?.title ?? ""}
        description={bulk?.description}
        confirmLabel={bulk?.confirmLabel}
        destructive={bulk?.destructive}
        onConfirm={async () => {
          if (bulk && (await apply(bulk.changes))) toast.success(bulk.done);
        }}
      />
    </div>
  );
}

/** Grid-shaped placeholder until the first state arrives. */
function RoutingSkeleton() {
  return (
    <div aria-busy aria-label="Loading routing" className="flex h-full flex-col gap-5 px-6 py-5">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="flex justify-center">
        <div className="grid gap-[3px]" style={{ gridTemplateColumns: `200px repeat(${BUSES}, 60px)` }}>
          {Array.from({ length: (STRIPS + 1) * (BUSES + 1) }, (_, k) => (
            <Skeleton key={k} className={k < BUSES + 1 ? "h-[52px]" : "h-11"} />
          ))}
        </div>
      </div>
    </div>
  );
}
