/**
 * Full-screen connection states: not installed · not running (Launch +
 * automatic retry) · wrong edition · DLL/login errors. Replaces the view content until
 * Voicemeeter Potato is connected. Uses the ConnectionBackdrop and WaitingIndicator slots.
 */
import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { Download, FileWarning, FlaskConical, Layers, Power, RotateCw, Unplug } from "lucide-react";
import { Button, QuickLink, toast } from "@/components/ui";
import ConnectionBackdrop, { type ConnectionBackdropProps } from "@/components/slots/ConnectionBackdrop";
import WaitingIndicator from "@/components/slots/WaitingIndicator";
import { bridge, errorMessage, type ConnectionState } from "@/lib/bridge";
import { openUrl } from "@tauri-apps/plugin-opener";
import { DEMO_AVAILABLE, DOWNLOAD_URL, editionName, useEngineInfo, useEngineInfoStore } from "./connection";

type Disconnected = Exclude<ConnectionState, { status: "connected" } | { status: "starting" }>;

const LAUNCH_TIMEOUT_MS = 20_000;

function backdropState(c: Disconnected): ConnectionBackdropProps["state"] {
  switch (c.status) {
    case "dllNotFound":
    case "dllError":
      return "not-installed";
    case "wrongEdition":
      return "wrong-edition";
    default:
      return "not-running";
  }
}

async function openDownload() {
  try {
    await openUrl(DOWNLOAD_URL);
  } catch {
    toast.error("Couldn't open the browser", { description: DOWNLOAD_URL });
  }
}

function useRetry() {
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    setBusy(true);
    try {
      await bridge.retryConnection();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      // Give the engine a beat to report back so the button doesn't flicker.
      setTimeout(() => setBusy(false), 400);
    }
  };
  return { busy, retry };
}

function useLaunch() {
  const [launching, setLaunching] = useState(false);
  useEffect(() => {
    if (!launching) return;
    const t = setTimeout(() => {
      setLaunching(false);
      toast.message("Voicemeeter hasn't started yet", {
        description: "It may still be loading. Mixdeck keeps checking every second.",
      });
    }, LAUNCH_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [launching]);
  const launch = async () => {
    setLaunching(true);
    try {
      await bridge.launchVoicemeeter();
    } catch (err) {
      setLaunching(false);
      toast.error("Couldn't start Voicemeeter", { description: errorMessage(err) });
    }
  };
  return { launching, launch };
}

export function ConnectionScreen({ connection }: { connection: Disconnected }) {
  const { busy, retry } = useRetry();
  const { launching, launch } = useLaunch();
  const info = useEngineInfo();
  const [demoBusy, setDemoBusy] = useState(false);

  const enterDemo = async () => {
    setDemoBusy(true);
    try {
      await useEngineInfoStore.getState().setDemo(true);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDemoBusy(false);
    }
  };

  const retryButton = (
    <Button onClick={retry} loading={busy} icon={<RotateCw size={14} strokeWidth={1.5} />}>
      Retry now
    </Button>
  );
  const downloadButton = (variant: "primary" | "secondary") => (
    <Button variant={variant} onClick={openDownload} icon={<Download size={14} strokeWidth={1.5} />}>
      Download Voicemeeter Potato
    </Button>
  );

  let icon: ReactNode;
  let title: string;
  let body: ReactNode;
  let actions: ReactNode;
  let status: ReactNode = null;
  let details: ReactNode = null;

  switch (connection.status) {
    case "notRunning":
      icon = <Power size={20} strokeWidth={1.5} />;
      title = "Voicemeeter isn't running";
      body = "Mixdeck controls Voicemeeter Potato. Start it and the mixer opens here by itself.";
      actions = (
        <>
          <Button variant="primary" onClick={launch} loading={launching} icon={<Power size={14} strokeWidth={1.5} />}>
            Launch Voicemeeter
          </Button>
          {retryButton}
        </>
      );
      status = <WaitingIndicator label={launching ? "Starting Voicemeeter…" : "Waiting for Voicemeeter. Checking every second."} />;
      break;
    case "wrongEdition":
      icon = <Layers size={20} strokeWidth={1.5} />;
      title = "Mixdeck needs Voicemeeter Potato";
      body = (
        <>
          {editionName(connection.vmType)} is running. Mixdeck is laid out for Potato's 8 inputs and 8 buses.
          Close {editionName(connection.vmType)}, then launch Potato.
        </>
      );
      actions = (
        <>
          <Button variant="primary" onClick={launch} loading={launching} icon={<Power size={14} strokeWidth={1.5} />}>
            Launch Voicemeeter Potato
          </Button>
          {downloadButton("secondary")}
        </>
      );
      status = <WaitingIndicator label="Checking every second." />;
      break;
    case "dllNotFound":
      icon = <Download size={20} strokeWidth={1.5} />;
      title = "Voicemeeter isn't installed";
      body = "Mixdeck works on top of Voicemeeter Potato from VB-Audio. Install it, then retry.";
      actions = (
        <>
          {downloadButton("primary")}
          {retryButton}
        </>
      );
      status = <WaitingIndicator label="Checking again every 10 seconds." />;
      details =
        connection.searched.length > 0 ? (
          <Details title="Looked for VoicemeeterRemote64.dll in">
            {connection.searched.map((p) => (
              <li key={p} className="break-all">
                {p}
              </li>
            ))}
          </Details>
        ) : null;
      break;
    case "dllError":
      icon = <FileWarning size={20} strokeWidth={1.5} />;
      title = "Voicemeeter's control library didn't load";
      body = "The install may be damaged or from an incompatible version. Reinstalling Voicemeeter Potato usually fixes this.";
      actions = (
        <>
          {retryButton}
          {downloadButton("secondary")}
        </>
      );
      details = (
        <Details title="Error">
          <li className="break-words">{connection.message}</li>
        </Details>
      );
      break;
    case "loginFailed":
      icon = <Unplug size={20} strokeWidth={1.5} />;
      title = "Voicemeeter refused the connection";
      body = "Quit Mixdeck from the tray and open it again. If it keeps happening, restart Voicemeeter first.";
      actions = null;
      details = (
        <Details title={`Error ${connection.code}`}>
          <li className="break-words">{connection.message}</li>
        </Details>
      );
      break;
  }

  const showDemo = DEMO_AVAILABLE && info?.backend !== "fake";

  return (
    <div className="relative flex h-full items-center justify-center overflow-auto bg-bg">
      <ConnectionBackdrop state={backdropState(connection)} />
      <motion.div
        key={connection.status}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="relative flex w-full max-w-[460px] flex-col gap-5 px-6 py-10"
        role="region"
        aria-labelledby="connection-title"
      >
        <div className="flex size-10 items-center justify-center rounded-lg border border-line-strong bg-panel text-text">
          {icon}
        </div>
        <div className="flex flex-col gap-1.5">
          <h1 id="connection-title" className="text-16 font-semibold text-text">
            {title}
          </h1>
          <p className="max-w-[52ch] text-13 text-text-dim">{body}</p>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        {status}
        {details}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-4">
          <QuickLink to="settings">Settings</QuickLink>
          {connection.status !== "dllNotFound" ? <QuickLink href={DOWNLOAD_URL}>Voicemeeter downloads</QuickLink> : null}
          {showDemo ? (
            <button
              type="button"
              onClick={enterDemo}
              disabled={demoBusy}
              className="inline-flex items-center gap-1 rounded-sm text-13 text-text-dim underline decoration-line-strong underline-offset-4 transition-colors duration-150 ease-out hover:text-text hover:decoration-text-dim disabled:opacity-40"
            >
              <FlaskConical size={14} strokeWidth={1.5} aria-hidden />
              Use demo mode
            </button>
          ) : null}
        </div>
      </motion.div>
    </div>
  );
}

function Details({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-panel px-3 py-2.5">
      <span className="text-12 text-text-dim">{title}</span>
      <ul className="tabular flex flex-col gap-1 text-11 text-text-faint select-text">{children}</ul>
    </div>
  );
}
