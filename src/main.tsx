import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles/index.css";
import { Shell } from "./app/Shell";
import { bridge, inTauri } from "./lib/bridge";
import { initEngine } from "./stores/mixerStore";
import { initSessions } from "./stores/sessionsStore";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from index.html");

createRoot(root).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);

initEngine();
initSessions();

// Show the window only after the first frame is painted (no white flash). Two rAFs = after paint.
if (inTauri) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      bridge.appReady().catch((err: unknown) => console.error("app_ready failed", err));
    }),
  );
}
