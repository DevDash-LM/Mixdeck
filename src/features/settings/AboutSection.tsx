import { useEffect, useState } from "react";
import { getTauriVersion, getVersion } from "@tauri-apps/api/app";
import BrandMark from "@/components/slots/BrandMark";
import { Button, Skeleton, toast } from "@/components/ui";
import { bridge, errorMessage, inTauri, type AboutInfo } from "@/lib/bridge";

interface Versions {
  app: string;
  tauri: string;
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <dt className="text-12 text-text-dim">{label}</dt>
      <dd className="tabular text-12 text-text">{value ?? <Skeleton className="h-4 w-16" />}</dd>
    </div>
  );
}

export default function AboutSection() {
  const [versions, setVersions] = useState<Versions | null>(null);
  const [failed, setFailed] = useState(false);
  const [info, setInfo] = useState<AboutInfo | null>(null);
  useEffect(() => {
    if (inTauri) bridge.getAboutInfo().then(setInfo).catch(() => setFailed(true));
  }, []);
  const openLogs = () =>
    bridge.openLogFolder().catch((err) => toast.error("Couldn't open the log folder", { description: errorMessage(err) }));

  useEffect(() => {
    if (!inTauri) {
      setFailed(true);
      return;
    }
    let alive = true;
    Promise.all([getVersion(), getTauriVersion()])
      .then(([app, tauri]) => alive && setVersions({ app, tauri }))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const value = (v: string | undefined) => (failed ? "unavailable" : (v ?? null));

  return (
    <div className="flex items-start gap-5">
      <BrandMark size={64} />
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="text-14 font-medium text-text">Mixdeck</p>
        <p className="text-12 text-text-dim">A control surface for Voicemeeter Potato.</p>
        <dl className="mt-3 flex flex-col">
          <Row label="Version" value={value(versions?.app)} />
          <Row label="Tauri" value={value(versions?.tauri)} />
          <Row label="Voicemeeter" value={failed ? "unavailable" : info ? (info.vmVersion ?? "Not connected") : null} />
          <Row label="Remote DLL" value={failed ? "unavailable" : info ? (info.dllVersion ?? "Not found") : null} />
          <Row label="Engine" value={failed ? "unavailable" : info ? (info.backend === "fake" ? "Demo (simulated)" : "Voicemeeter") : null} />
        </dl>
        {info?.dllPath ? (
          <p className="mt-2 truncate text-11 text-text-faint" title={info.dllPath}>
            {info.dllPath}
          </p>
        ) : null}
        <div className="mt-3 flex gap-2">
          <Button variant="secondary" size="sm" onClick={openLogs} disabled={!inTauri}>
            Open log folder
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!inTauri}
            onClick={() => bridge.openPresetsFolder().catch((err) => toast.error("Couldn't open the presets folder", { description: errorMessage(err) }))}
          >
            Open presets folder
          </Button>
        </div>
      </div>
    </div>
  );
}
