import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Badge, Card, EmptyState, Input, SectionTitle, Select } from "@/components/common/ui";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { useApp } from "@/context/AppContext";

export const Route = createFileRoute("/admin/logs")({
  head: () => ({
    meta: [
      { title: "System logs — DermaAI" },
      { name: "description", content: "Audit trail of logins, analyses and reviews across DermaAI." },
      { property: "og:title", content: "System logs — DermaAI" },
      {
        property: "og:description",
        content: "Audit trail of logins, analyses and reviews across DermaAI.",
      },
    ],
  }),
  component: () => (
    <DashboardLayout role="admin">
      <Inner />
    </DashboardLayout>
  ),
});

function Inner() {
  const { logs } = useApp();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("all");

  const rows = logs.filter(
    (l) =>
      (role === "all" || l.role === role) &&
      (!query ||
        l.user.toLowerCase().includes(query.toLowerCase()) ||
        l.action.toLowerCase().includes(query.toLowerCase())),
  );

  return (
    <>
      <SectionTitle eyebrow="Logs" title="System logs" />

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            placeholder="Search by user or action"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="all">All roles</option>
            <option value="patient">Patient</option>
            <option value="dermatologist">Dermatologist</option>
            <option value="admin">Administrator</option>
          </Select>
        </div>
      </Card>

      {rows.length === 0 ? (
        <EmptyState title="No log entries match" hint="Try a different search term." />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium uppercase tracking-[0.08em] text-mute">
                  <th className="px-5 py-2.5 font-medium">Timestamp</th>
                  <th className="px-5 py-2.5 font-medium">User</th>
                  <th className="px-5 py-2.5 font-medium">Role</th>
                  <th className="px-5 py-2.5 font-medium">Action</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((l) => (
                  <tr key={l.id} className="hover:bg-canvas2">
                    <td className="px-5 py-3 text-inksoft">{l.timestamp}</td>
                    <td className="px-5 py-3 font-medium">{l.user}</td>
                    <td className="px-5 py-3 text-inksoft capitalize">{l.role}</td>
                    <td className="px-5 py-3 text-inksoft">{l.action}</td>
                    <td className="px-5 py-3">
                      <Badge tone={l.status === "Success" ? "brand" : "risk"}>{l.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
