"use client";

import { FileText, Menu, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Brand } from "@/components/brand";
import { UserMenu } from "@/components/user-menu";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { Me } from "@/lib/types";

const NAV = [
  { href: "/", label: "Documents", icon: FileText },
  { href: "/members", label: "Members", icon: Users },
];

function SidebarContent({ me, onNavigate }: { me: Me; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <Brand onClick={onNavigate} className="px-3 pt-1 text-sm" />
      <WorkspaceSwitcher me={me} onNavigate={onNavigate} />
      <nav aria-label="Main" className="flex flex-col gap-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
              )}
            >
              <Icon className={cn("size-4", active && "text-sidebar-primary")} aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto">
        <UserMenu user={me.user} />
      </div>
    </div>
  );
}

export function AppShell({ me, children }: { me: Me; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const active = me.workspaces.find((w) => w.id === me.activeWorkspaceId);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 hidden h-screen border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:block">
        <SidebarContent me={me} />
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="flex items-center gap-3 border-b px-4 py-3 lg:hidden">
          <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="size-5" aria-hidden />
          </Button>
          <span className="truncate text-sm font-medium">{active?.name}</span>
        </header>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="left" className="w-72 bg-sidebar p-0 text-sidebar-foreground">
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <SidebarContent me={me} onNavigate={() => setOpen(false)} />
          </SheetContent>
        </Sheet>

        <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8 lg:py-10">{children}</main>
      </div>
    </div>
  );
}
