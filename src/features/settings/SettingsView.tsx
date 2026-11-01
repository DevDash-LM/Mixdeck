import { useEffect, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { ErrorState, IconButton, Skeleton, toast } from "@/components/ui";
import type { SettingsPatch } from "@/lib/bridge";
import { useNavigation } from "@/stores/navigationStore";
import { useSettings } from "@/stores/settingsStore";
import { listSettingsSections } from "./sections";

function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-lg border border-line bg-panel">
      <h2 className="border-b border-line px-4 py-2.5 text-11 font-medium tracking-wide text-text-faint uppercase">
        {title}
      </h2>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

function LoadingSections() {
  return (
    <div className="flex flex-col gap-4" aria-busy aria-label="Loading settings">
      {[0, 1].map((i) => (
        <div key={i} className="rounded-lg border border-line bg-panel p-4">
          <Skeleton className="mb-4 h-3 w-20" />
          <Skeleton className="mb-3 h-5 w-full" />
          <Skeleton className="h-5 w-2/3" />
        </div>
      ))}
    </div>
  );
}

export default function SettingsView() {
  const back = useNavigation((s) => s.back);
  const { settings, status, error, load, update } = useSettings();

  useEffect(() => {
    if (status === "idle") void load();
  }, [status, load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && document.querySelectorAll("[role='dialog']").length === 0) back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back]);

  const save = async (patch: SettingsPatch) => {
    try {
      await update(patch);
    } catch (err) {
      toast.error("Couldn't save settings", { description: err instanceof Error ? err.message : undefined });
      throw err;
    }
  };

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-5 px-6 py-6">
        <div className="flex items-center gap-2">
          <IconButton label="Back" size="sm" icon={<ArrowLeft size={16} strokeWidth={1.5} />} onClick={back} />
          <h1 className="text-16 font-semibold text-text">Settings</h1>
        </div>

        {status === "error" ? (
          <ErrorState title="Couldn't load settings" message={error ?? undefined} retry={load} />
        ) : !settings ? (
          <LoadingSections />
        ) : (
          listSettingsSections().map(({ id, title, component: Section }) => (
            <SectionCard key={id} title={title}>
              <Section settings={settings} update={save} />
            </SectionCard>
          ))
        )}
      </div>
    </div>
  );
}
