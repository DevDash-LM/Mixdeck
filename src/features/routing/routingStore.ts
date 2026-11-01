/**
 * Routing view state shared with the Mixer: which strip row to highlight when the view opens
 * from a strip's "Edit routing".
 */
import { create } from "zustand";
import { useNavigation } from "@/stores/navigationStore";

export const ROUTING_VIEW = "routing";

interface RoutingStore {
  /** Strip row to highlight and focus, with a nonce so the same row can be asked for twice. */
  highlight: { strip: number; nonce: number } | null;
  clearHighlight: () => void;
}

export const useRouting = create<RoutingStore>((set) => ({
  highlight: null,
  clearHighlight: () => set({ highlight: null }),
}));

let nonce = 0;

/** Opens the Routing view with strip `i`'s row highlighted. */
export function openRouting(strip?: number): void {
  if (strip !== undefined) useRouting.setState({ highlight: { strip, nonce: ++nonce } });
  useNavigation.getState().navigate(ROUTING_VIEW);
}
