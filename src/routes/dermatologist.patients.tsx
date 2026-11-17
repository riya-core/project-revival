import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Badge, Button, Card, EmptyState, Input, Modal, SectionTitle, statusTone } from "@/components/common/ui";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { useApp } from "@/context/AppContext";

export const Route = createFileRoute("/dermatologist/patients")({
  head: () => ({
    meta: [
      { title: "Manage patients — DermaAI" },
      { name: "description", content: "See every patient, their scan count and latest AI prediction." },
      { property: "og:title", content: "Manage patients — DermaAI" },
      {
        property: "og:description",
        content: "See every patient, their scan count and latest AI prediction.",
      },
    ],
  }),
  component: () => (
    <DashboardLayout role="dermatologist">
      <Inner />
    </DashboardLayout>
  ),
});

function Inner() {
  const { users, predictions } = useApp();
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const patients = users
    .filter(
      (u) =>
        u.role === "patient" &&
        !u.email.toLowerCase().includes("admin") &&
        !u.name.toLowerCase().includes("admin"),
    )
    .filter((u) => !query || u.name.toLowerCase().includes(query.toLowerCase()));

  const selected = patients.find((p) => p.id === openId) ?? null;
  const selectedScans = predictions.filter((p) => p.patientId === openId);

  return (
    <>
      <SectionTitle eyebrow="Patients" title="Manage patients" />

      <Card className="p-4">
        <Input
          placeholder="Search patients by name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </Card>

      {patients.length === 0 ? (
        <EmptyState title="No patients found" hint="Try a different search term." />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium uppercase tracking-[0.08em] text-mute">
                  <th className="px-5 py-2.5 font-medium">Patient</th>
                  <th className="px-5 py-2.5 font-medium">Age / gender</th>
                  <th className="px-5 py-2.5 font-medium">Scans</th>
                  <th className="px-5 py-2.5 font-medium">Last prediction</th>
                  <th className="px-5 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {patients.map((u) => {
                  const scans = predictions.filter((p) => p.patientId === u.id);
                  const last = scans[0];
                  return (
                    <tr key={u.id} className="hover:bg-canvas2">
                      <td className="px-5 py-3">
                        <div className="font-medium">{u.name}</div>
                        <div className="text-xs text-mute">{u.email}</div>
                      </td>
                      <td className="px-5 py-3 text-inksoft">
                        {u.age ?? "—"} · {u.gender ?? "—"}
                      </td>
                      <td className="px-5 py-3 text-inksoft">{scans.length}</td>
                      <td className="px-5 py-3 text-inksoft">
                        {last ? `${last.disease} (${last.confidence}%)` : "—"}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button
                          onClick={() => setOpenId(u.id)}
                          className="text-xs font-medium text-brand hover:text-brandink"
                        >
                          View history
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal
        open={Boolean(selected)}
        title={selected ? `${selected.name} · scan history` : ""}
        onClose={() => setOpenId(null)}
      >
        {selectedScans.length === 0 ? (
          <p className="text-sm text-mute">This patient has not uploaded any scans yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {selectedScans.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-line p-3"
              >
                <div>
                  <div className="text-sm font-medium">{p.disease}</div>
                  <div className="text-xs text-mute">
                    {p.date} · {p.region} · {p.confidence}%
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                  <Link
                    to="/dermatologist/reports/$id"
                    params={{ id: p.id }}
                    className="text-xs font-medium text-brand hover:text-brandink"
                  >
                    Open
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={() => setOpenId(null)}>
            Close
          </Button>
        </div>
      </Modal>
    </>
  );
}
