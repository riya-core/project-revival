import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
import { dashboardPath, useApp } from "@/context/AppContext";
import type { Role } from "@/data/mockData";
import { cn } from "@/lib/utils";

const navByRole: Record<Role, { to: string; label: string }[]> = {
  patient: [
    { to: "/patient/dashboard", label: "Dashboard" },
    { to: "/patient/analyze", label: "Analyze skin" },
    { to: "/patient/history", label: "My history" },
    { to: "/patient/profile", label: "Profile" },
  ],
  dermatologist: [
    { to: "/dermatologist/dashboard", label: "Dashboard" },
    { to: "/dermatologist/reports", label: "Patient reports" },
    { to: "/dermatologist/patients", label: "Manage patients" },
    { to: "/dermatologist/profile", label: "Profile" },
  ],
  admin: [
    { to: "/admin/dashboard", label: "Dashboard" },
    { to: "/admin/users", label: "Manage users" },
    { to: "/admin/settings", label: "System settings" },
    { to: "/admin/logs", label: "System logs" },
    { to: "/admin/profile", label: "Profile" },
  ],
};

const roleLabel: Record<Role, string> = {
  patient: "Patient",
  dermatologist: "Dermatologist",
  admin: "Administrator",
};

export function DashboardLayout({ role, children }: { role: Role; children: ReactNode }) {
  const { user, hydrated, logout } = useApp();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (!hydrated) return;
    if (!user) {
      navigate({ to: "/login" });
    } else if (user.role !== role) {
      navigate({ to: dashboardPath[user.role] });
    }
  }, [hydrated, user, role, navigate]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  if (!hydrated || !user || user.role !== role) {
    return (
      <div className="grid min-h-screen place-items-center bg-canvas text-sm text-mute">
        Loading your workspace…
      </div>
    );
  }

  const items = navByRole[role];
  const initials = user.name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const sidebar = (
    <div className="rounded-2xl border border-line bg-surface p-3">
      <div className="flex items-center gap-3 rounded-xl bg-canvas2 p-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-full bg-brand/10 font-display text-sm font-semibold text-brandink">
          {initials}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{user.name}</div>
          <div className="truncate text-xs text-mute">
            {roleLabel[role]} · since {user.createdAt}
          </div>
        </div>
      </div>
      <nav className="mt-3 flex flex-col gap-1 text-sm font-medium">
        {items.map((item) => {
          const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "rounded-lg px-3 py-2",
                active ? "bg-brand/10 text-brandink" : "text-inksoft hover:bg-canvas2",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-3 border-t border-line pt-3">
        <button
          onClick={() => {
            logout();
            navigate({ to: "/login" });
          }}
          className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-inksoft hover:bg-canvas2"
        >
          Log out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="grid size-8 place-items-center rounded-lg bg-brand font-display text-sm font-semibold text-surface">
              D
            </div>
            <span className="font-display text-lg font-semibold tracking-tight">DermaAI</span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-mute sm:inline">
              Signed in as {user.name} · {roleLabel[role]}
            </span>
            <button
              className="rounded-lg border border-line p-2 text-inksoft lg:hidden"
              onClick={() => setOpen((v) => !v)}
              aria-label="Toggle navigation"
            >
              {open ? <X className="size-4" /> : <Menu className="size-4" />}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="grid gap-5 lg:grid-cols-12">
          <aside className="hidden lg:col-span-3 lg:block">{sidebar}</aside>
          {open ? <div className="lg:hidden">{sidebar}</div> : null}
          <div className="flex flex-col gap-5 lg:col-span-9">{children}</div>
        </div>
      </div>
    </div>
  );
}
