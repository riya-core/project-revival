import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button, Card, Field, Input, Select } from "@/components/common/ui";
import { dashboardPath, useApp } from "@/context/AppContext";
import type { Role } from "@/data/mockData";
import { Nav } from "./index";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "Create an account — DermaAI" },
      {
        name: "description",
        content: "Register as a patient or dermatologist to use the DermaAI prototype.",
      },
      { property: "og:title", content: "Create an account — DermaAI" },
      {
        property: "og:description",
        content: "Register as a patient or dermatologist to use the DermaAI prototype.",
      },
    ],
  }),
  component: RegisterPage,
});

function RegisterPage() {
  const { register } = useApp();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirm: "",
    role: "patient" as Exclude<Role, "admin">,
  });
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (form.name.trim().length < 3) next["name"] = "Enter your full name.";
    if (!/^\S+@\S+\.\S+$/.test(form.email)) next["email"] = "Enter a valid email address.";
    if (form.password.length < 6) next["password"] = "Use at least 6 characters.";
    if (form.password !== form.confirm) next["confirm"] = "Passwords do not match.";
    setErrors(next);
    if (Object.keys(next).length) return;

    const session = register(form.name.trim(), form.email.trim(), form.role);
    navigate({ to: dashboardPath[session.role] });
  };

  return (
    <div className="min-h-screen bg-canvas">
      <Nav />
      <div className="mx-auto max-w-2xl px-6 py-12">
        <Card className="p-6">
          <div className="text-xs font-medium uppercase tracking-[0.16em] text-brand">Register</div>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">
            Create your DermaAI account
          </h1>
          <p className="mt-2 text-sm text-mute">
            Administrator accounts are provisioned internally and cannot be self-registered.
          </p>

          <form className="mt-6 grid gap-4" onSubmit={submit}>
            <Field label="Full name" {...(errors["name"] ? { error: errors["name"] } : {})}>
              <Input value={form.name} onChange={set("name")} placeholder="Rahul Mehta" />
            </Field>
            <Field label="Email" {...(errors["email"] ? { error: errors["email"] } : {})}>
              <Input type="email" value={form.email} onChange={set("email")} placeholder="you@example.com" />
            </Field>
            <Field label="Password" {...(errors["password"] ? { error: errors["password"] } : {})}>
              <div className="relative">
                <Input
                  type={show ? "text" : "password"}
                  value={form.password}
                  onChange={set("password")}
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
            <Field label="Confirm password" {...(errors["confirm"] ? { error: errors["confirm"] } : {})}>
              <Input type={show ? "text" : "password"} value={form.confirm} onChange={set("confirm")} />
            </Field>
            <Field label="Role">
              <Select value={form.role} onChange={set("role")}>
                <option value="patient">Patient</option>
                <option value="dermatologist">Dermatologist</option>
              </Select>
            </Field>

            <Button type="submit">Create account</Button>

            <p className="text-sm text-mute">
              Already registered?{" "}
              <Link to="/login" className="font-medium text-brand hover:text-brandink">
                Log in
              </Link>
            </p>
          </form>
        </Card>
      </div>
    </div>
  );
}
