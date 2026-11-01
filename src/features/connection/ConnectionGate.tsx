/**
 * Shows `children` only once Voicemeeter Potato is connected and the first state has been read.
 * Until then: `fallback` (a skeleton) while starting, the friendly Connection screen when
 * Voicemeeter is missing / not running / the wrong edition, or an error when the bridge itself
 * failed. Every view that needs Voicemeeter wraps its content in this.
 */
import type { ReactNode } from "react";
import { ErrorState, QuickLink } from "@/components/ui";
import { useMixer } from "@/stores/mixerStore";
import { ConnectionScreen } from "./ConnectionScreen";

export interface ConnectionGateProps {
  children: ReactNode;
  /** Shown while connecting / before the first state (default: nothing). */
  fallback?: ReactNode;
}

export function ConnectionGate({ children, fallback = null }: ConnectionGateProps) {
  const status = useMixer((s) => s.status);
  const error = useMixer((s) => s.error);
  const connection = useMixer((s) => s.connection);
  const hasState = useMixer((s) => (s.state?.rev ?? 0) > 0);
  const init = useMixer((s) => s.init);

  if (status === "error") {
    return (
      <ErrorState
        className="h-full"
        title="Mixdeck's engine didn't start"
        message={error ?? "The connection to Mixdeck's audio engine failed."}
        retry={init}
        secondary={<QuickLink to="settings">Open settings</QuickLink>}
      />
    );
  }
  if (status === "idle" || status === "loading" || connection.status === "starting") return <>{fallback}</>;
  if (connection.status === "connected") return hasState ? <>{children}</> : <>{fallback}</>;
  return <ConnectionScreen connection={connection} />;
}
