import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { inTauri } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { useNavigation } from "@/stores/navigationStore";
import { toast } from "./Toast";

type Target = { to: string; href?: never } | { href: string; to?: never };

export type QuickLinkProps = Target & {
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
};

/**
 * Inline link-style action. `to` navigates to a registered view id; `href` opens an external
 * URL in the default browser (with an arrow icon).
 */
export function QuickLink({ to, href, children, icon, className }: QuickLinkProps) {
  const navigate = useNavigation((s) => s.navigate);
  const onClick = async () => {
    if (to) {
      navigate(to);
      return;
    }
    if (!href) return;
    try {
      if (inTauri) await openUrl(href);
      else window.open(href, "_blank", "noopener");
    } catch {
      toast.error("Couldn't open the link", { description: href });
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm text-13 text-text-dim underline decoration-line-strong underline-offset-4",
        "transition-colors duration-150 ease-out hover:text-text hover:decoration-text-dim",
        className,
      )}
    >
      {icon}
      {children}
      {href ? <ArrowUpRight size={14} strokeWidth={1.5} aria-hidden /> : null}
      {href ? <span className="sr-only"> (opens in browser)</span> : null}
    </button>
  );
}
