/**
 * The bus EQ chip's right-click, the bus ⋯ "EQ editor…" item and Routing's column menu
 * open the Bus EQ drawer. Only one effects drawer is open at a time.
 */
import { registerMixerActions, registerMixerOverlay } from "@/features/mixer/extensions";
import { useStripFx } from "@/features/strip-fx/stripFxStore";
import BusEqDrawer from "./BusEqDrawer";
import { useBusEq } from "./busEqStore";

registerMixerActions({
  openBusEq: (j) => {
    useStripFx.getState().close();
    useBusEq.getState().openEq(j);
  },
});
registerMixerOverlay({ id: "bus-eq", component: BusEqDrawer });

useStripFx.subscribe((s, prev) => {
  if (s.open && !prev.open) useBusEq.getState().close();
});
