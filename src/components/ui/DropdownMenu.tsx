import type { ComponentProps, ReactNode } from "react";
import * as DM from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

/** shadcn-style composition over Radix DropdownMenu. */
export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;
export const DropdownMenuGroup = DM.Group;
export const DropdownMenuSub = DM.Sub;
export const DropdownMenuRadioGroup = DM.RadioGroup;

const itemClass =
  "relative flex h-7 cursor-default items-center gap-2 rounded-md px-2 text-13 text-text outline-none select-none " +
  "data-[highlighted]:bg-panel-2 data-[disabled]:text-text-faint data-[disabled]:pointer-events-none";

export function DropdownMenuContent({ className, sideOffset = 4, ...props }: ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn("z-50 min-w-40 rounded-lg bg-panel p-1 shadow-overlay", className)}
        {...props}
      />
    </DM.Portal>
  );
}

export interface DropdownMenuItemProps extends ComponentProps<typeof DM.Item> {
  icon?: ReactNode;
  shortcut?: string;
  destructive?: boolean;
}

export function DropdownMenuItem({ className, icon, shortcut, destructive, children, ...props }: DropdownMenuItemProps) {
  return (
    <DM.Item className={cn(itemClass, destructive && "text-mute", className)} {...props}>
      {icon ? <span className="inline-flex shrink-0 text-text-dim">{icon}</span> : null}
      <span className="flex-1 truncate">{children}</span>
      {shortcut ? <span className="tabular text-11 text-text-faint">{shortcut}</span> : null}
    </DM.Item>
  );
}

export function DropdownMenuCheckboxItem({ className, children, ...props }: ComponentProps<typeof DM.CheckboxItem>) {
  return (
    <DM.CheckboxItem className={cn(itemClass, "pl-7", className)} {...props}>
      <DM.ItemIndicator className="absolute left-2 inline-flex">
        <Check size={14} strokeWidth={1.5} />
      </DM.ItemIndicator>
      {children}
    </DM.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({ className, children, ...props }: ComponentProps<typeof DM.RadioItem>) {
  return (
    <DM.RadioItem className={cn(itemClass, "pl-7", className)} {...props}>
      <DM.ItemIndicator className="absolute left-2 inline-flex">
        <Check size={14} strokeWidth={1.5} />
      </DM.ItemIndicator>
      {children}
    </DM.RadioItem>
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof DM.Label>) {
  return (
    <DM.Label
      className={cn("px-2 pt-1 pb-0.5 text-11 font-medium tracking-wide text-text-faint uppercase", className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof DM.Separator>) {
  return <DM.Separator className={cn("my-1 h-px bg-line", className)} {...props} />;
}

export function DropdownMenuSubTrigger({ className, ...props }: ComponentProps<typeof DM.SubTrigger>) {
  return <DM.SubTrigger className={cn(itemClass, "data-[state=open]:bg-panel-2", className)} {...props} />;
}

export function DropdownMenuSubContent({ className, ...props }: ComponentProps<typeof DM.SubContent>) {
  return (
    <DM.Portal>
      <DM.SubContent className={cn("z-50 min-w-40 rounded-lg bg-panel p-1 shadow-overlay", className)} {...props} />
    </DM.Portal>
  );
}
