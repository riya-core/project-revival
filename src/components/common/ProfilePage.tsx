import { useState } from "react";
import { Button, Card, Field, Input, SectionTitle, Select } from "@/components/common/ui";
import { useApp } from "@/context/AppContext";
import type { Role } from "@/data/mockData";

const roleLabel: Record<Role, string> = {
  patient: "Patient",
  dermatologist: "Dermatologist",
  admin: "Administrator",
};

export function ProfilePage({ role }: { role: Role }) {
  const { user, updateProfile, predictions } = useApp();
  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [age, setAge] = useState(user?.age ? String(user.age) : "");
  const [gender, setGender] = useState(user?.gender ?? "");
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const mine = predictions.filter((p) => p.patientId === user?.id);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    const result = await updateProfile({
      ...(trimmedName ? { name: trimmedName } : {}),
      phone: phone.trim(),
      ...(age ? { age: Number(age) } : {}),
      ...(gender ? { gender } : {}),
    });
    setSaveError(result.ok ? null : result.error);
    if (!result.ok) return;
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  const initials = (user?.name ?? "")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <>
      <SectionTitle
        eyebrow="Account"
        title="Profile"
        right={<span className="text-sm text-mute">{roleLabel[role]} account</span>}
      />

      <Card className="p-5">
        <div className="flex items-center gap-4">
          <div className="grid size-14 place-items-center rounded-full bg-brand/10 font-display text-lg font-semibold text-brandink">
            {initials}
          </div>
          <div>
            <div className="font-display text-lg font-semibold">{user?.name}</div>
            <div className="text-sm text-mute">
              {user?.email} · member since {user?.createdAt}
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSave}>
          <Field label="Full name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Email" hint="Email cannot be changed in this prototype">
            <Input value={user?.email ?? ""} readOnly className="bg-canvas2 text-mute" />
          </Field>
          <Field label="Phone">
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 90000 00000"
            />
          </Field>
          {role === "patient" ? (
            <>
              <Field label="Age">
                <Input
                  type="number"
                  min={1}
                  max={120}
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  placeholder="28"
                />
              </Field>
              <Field label="Gender">
                <Select value={gender} onChange={(e) => setGender(e.target.value)}>
                  <option value="">Prefer not to say</option>
                  <option value="Female">Female</option>
                  <option value="Male">Male</option>
                  <option value="Other">Other</option>
                </Select>
              </Field>
            </>
          ) : null}
          <div className="sm:col-span-2 flex items-center gap-3">
            <Button type="submit">Save changes</Button>
            {saved ? (
              <span className="text-sm font-medium text-brandink">Profile updated</span>
            ) : null}
            {saveError ? <span role="alert" className="text-sm font-medium text-riskink">{saveError}</span> : null}
          </div>
        </form>
      </Card>

      {role === "patient" ? (
        <Card className="p-5">
          <div className="text-sm font-semibold">Activity summary</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3 text-sm">
            <div>
              <div className="text-xs text-mute">Total scans</div>
              <div className="mt-1 font-display text-xl font-semibold">{mine.length}</div>
            </div>
            <div>
              <div className="text-xs text-mute">Reviewed reports</div>
              <div className="mt-1 font-display text-xl font-semibold">
                {mine.filter((p) => p.review).length}
              </div>
            </div>
            <div>
              <div className="text-xs text-mute">Last scan</div>
              <div className="mt-1 font-display text-xl font-semibold">{mine[0]?.date ?? "—"}</div>
            </div>
          </div>
        </Card>
      ) : null}

      <p className="text-xs text-mute">
        DermaAI is an educational decision-support prototype. Your profile is stored in your
        DermaAI account and is only visible to you, your care team and administrators.
      </p>
    </>
  );
}
