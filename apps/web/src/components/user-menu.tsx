"use client";

import { ChevronsUpDown, LogOut } from "lucide-react";
import { type Theme, useTheme } from "@/components/theme-provider";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { api, ApiError } from "@/lib/api";
import type { Me } from "@/lib/types";

export function UserMenu({ user }: { user: Me["user"] }) {
  const router = useRouter();
  const { theme = "system", setTheme } = useTheme();

  async function signOut() {
    try {
      await api("/auth/logout", { method: "POST", handleSessionLoss: false });
      router.replace("/login");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not sign out. Try again.");
    }
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-auto w-full justify-between gap-2 px-3 py-2 text-left" aria-label="Account menu">
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{user.name ?? user.email}</span>
            {user.name && <span className="block truncate text-xs text-muted-foreground">{user.email}</span>}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)}>
          <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <LogOut className="size-4" aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
