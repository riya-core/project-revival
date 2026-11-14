import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button, Card, Field, Input, Select } from "@/components/common/ui";
import { dashboardPath, useApp } from "@/context/AppContext";
import { DEMO_ACCOUNTS, type Role } from "@/data/mockData";
import { Nav } from "./index";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Login — DermaAI" },
      { name: "description", content: "Sign in to DermaAI as a patient, dermatologist or admin." },
      { property: "og:title", content: "Login — DermaAI" },
      {
        property: "og:description",
        content: "Sign in to DermaAI as a patient, dermatologist or admin.",
      },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { hydrated, login, user } = useApp();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("patient");
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (hydrated && user && !busy) navigate({ to: dashboardPath[user.role] });
  }, [busy, hydrated, navigate, user]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Enter a valid email address.");
    if (password.length < 6) return setError("Password must be at least 6 characters.");
    setError(null);
    setBusy(true);
    const result = await login(email, password, role);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    navigate({ to: dashboardPath[result.user.role] });
  };

  return (
    <div className="min-h-screen bg-canvas">
      <Nav />
      <div className="mx-auto grid max-w-6xl gap-5 px-6 py-12 lg:grid-cols-12">
        <Card className="p-6 lg:col-span-7">
          <div className="text-xs font-medium uppercase tracking-[0.16em] text-brand">Sign in</div>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">
            Welcome back to DermaAI
          </h1>

          <form className="mt-6 grid gap-4" onSubmit={submit}>
            <Field label="Email">
              <Input
                type="email"
                value={email}
                placeholder="patient@demo.com"
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>

            <Field label="Password">
              <div className="relative">
                <Input
                  type={show ? "text" : "password"}
                  value={password}
                  placeholder="Your password"
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-mute hover:text-ink"
                  aria-label={show ? "Hide password" : "Show password"}
                >
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>

            <Field label="Role">
              <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="patient">Patient</option>
                <option value="dermatologist">Dermatologist</option>
                <option value="admin">Admin</option>
              </Select>
            </Field>

            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <label className="flex items-center gap-2 text-inksoft">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="size-4 accent-brand"
                />
                Remember me
              </label>
              <button
                type="button"
                onClick={() => setNotice("Password reset is not available in this prototype.")}
                className="font-medium text-brand hover:text-brandink"
              >
                Forgot password?
              </button>
            </div>

            {error ? <div className="text-xs font-medium text-riskink">{error}</div> : null}
            {notice ? <div className="text-xs font-medium text-cautionink">{notice}</div> : null}

            <Button type="submit" disabled={busy}>{busy ? "Signing in…" : "Login"}</Button>

            <p className="text-sm text-mute">
              New here?{" "}
              <Link to="/register" className="font-medium text-brand hover:text-brandink">
                Create an account
              </Link>
            </p>
          </form>
        </Card>

        <Card className="p-6 lg:col-span-5">
          <div className="text-sm font-semibold">Demo accounts</div>
          <p className="mt-1 text-xs text-mute">
            Pick a role to fill in its sample email, then enter that account’s password.
          </p>
          <div className="mt-4 space-y-2">
            {(Object.keys(DEMO_ACCOUNTS) as Role[]).map((r) => (
              <button
                key={r}
                onClick={() => {
                  setRole(r);
                  setEmail(DEMO_ACCOUNTS[r]);
                }}
                className="flex w-full items-center justify-between rounded-xl bg-canvas2 px-3 py-2.5 text-left hover:bg-line/60"
              >
                <span className="text-sm font-medium capitalize">{r}</span>
                <span className="text-xs text-mute">{DEMO_ACCOUNTS[r]}</span>
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
