import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";
import { MotionConfig } from "motion/react";
import { Button, ErrorState, Toaster, TooltipProvider } from "@/components/ui";
import { inTauri, trayEvents } from "@/lib/bridge";
import { DEFAULT_VIEW, useNavigation } from "@/stores/navigationStore";
import { getView } from "./routes";
import { MAIN_PANEL_ID, TitleBar } from "./TitleBar";

class ViewErrorBoundary extends Component<{ children: ReactNode; onHome: () => void }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("view crashed", error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <ErrorState
        className="h-full"
        title="This view hit an error"
        message={this.state.error.message}
        retry={() => this.setState({ error: null })}
        secondary={
          <Button variant="ghost" onClick={this.props.onHome}>
            Back to Mixer
          </Button>
        }
      />
    );
  }
}

function CurrentView() {
  const current = useNavigation((s) => s.current);
  const navigate = useNavigation((s) => s.navigate);
  const view = getView(current);
  if (!view) {
    return (
      <ErrorState
        className="h-full"
        title="View not found"
        message={`No view is registered as "${current}".`}
        secondary={<Button onClick={() => navigate(DEFAULT_VIEW)}>Back to Mixer</Button>}
      />
    );
  }
  const View = view.component;
  return (
    <ViewErrorBoundary key={view.id} onHome={() => navigate(DEFAULT_VIEW)}>
      <View />
    </ViewErrorBoundary>
  );
}

/** Global shortcuts handled by the shell. */
function useShellShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+, opens Settings (common desktop convention).
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key === ",") {
        e.preventDefault();
        const { current, navigate, back } = useNavigation.getState();
        if (current === "settings") back();
        else navigate("settings");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function useTrayNavigation() {
  useEffect(() => {
    if (!inTauri) return;
    let unlisten: (() => void) | undefined;
    let alive = true;
    trayEvents
      .onNavigate((id) => {
        if (getView(id)) useNavigation.getState().navigate(id);
      })
      .then((u) => {
        if (alive) unlisten = u;
        else u();
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);
}

export function Shell() {
  useShellShortcuts();
  useTrayNavigation();
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <div className="flex h-full flex-col bg-bg">
          <TitleBar />
          <main id={MAIN_PANEL_ID} role="tabpanel" className="relative min-h-0 flex-1 overflow-hidden">
            <CurrentView />
          </main>
        </div>
        <Toaster />
      </TooltipProvider>
    </MotionConfig>
  );
}
