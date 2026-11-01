import { create } from "zustand";

/** Current view in the shell. View ids come from the registry in app/routes.ts. */
interface NavigationState {
  current: string;
  previous: string | null;
  navigate: (id: string) => void;
  /** Return to the previous view (falls back to the Mixer). */
  back: () => void;
}

export const DEFAULT_VIEW = "mixer";

export const useNavigation = create<NavigationState>((set, get) => ({
  current: DEFAULT_VIEW,
  previous: null,
  navigate: (id) => {
    const { current } = get();
    if (id === current) return;
    set({ current: id, previous: current });
  },
  back: () => {
    const { previous, current } = get();
    const target = previous && previous !== current ? previous : DEFAULT_VIEW;
    set({ current: target, previous: null });
  },
}));
