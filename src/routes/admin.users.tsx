import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Badge, Button, Card, EmptyState, Input, SectionTitle, Select } from "@/components/common/ui";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { useApp } from "@/context/AppContext";

export const Route = createFileRoute("/admin/users")({
  head: () => ({
    meta: [
      { title: "Manage users — DermaAI" },
      { name: "description", content: "Search accounts and activate or deactivate DermaAI users." },
      { property: "og:title", content: "Manage users — DermaAI" },
      {
        property: "og:description",
        content: "Search accounts and activate or deactivate DermaAI users.",
      },
    ],
  }),
  component: () => (
    <DashboardLayout role="admin">
      <Inner />
    </DashboardLayout>
  ),
});

const roleLabel = {
  patient: "Patient",
  dermatologist: "Dermatologist",
  admin: "Administrator",
} as const;

function Inner() {
  const { users, toggleUserStatus } = useApp();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");

  const rows = users.filter(
    (u) =>
      (role === "all" || u.role === role) &&
      (status === "all" || u.status === status) &&
      (!query ||
        u.name.toLowerCase().includes(query.toLowerCase()) ||
        u.email.toLowerCase().includes(query.toLowerCase())),
  );

  return (
    <>
      <SectionTitle eyebrow="Users" title="Manage users" />

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Input
            placeholder="Search name or email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="all">All roles</option>
            <option value="patient">Patient</option>
            <option value="dermatologist">Dermatologist</option>
            <option value="admin">Administrator</option>
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </Select>
        </div>
      </Card>

      {rows.length === 0 ? (
        <EmptyState title="No users match these filters" hint="Clear the search to see everyone." />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium uppercase tracking-[0.08em] text-mute">
                  <th className="px-5 py-2.5 font-medium">Name</th>
                  <th className="px-5 py-2.5 font-medium">Email</th>
                  <th className="px-5 py-2.5 font-medium">Role</th>
                  <th className="px-5 py-2.5 font-medium">Joined</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((u) => (
                  <tr key={u.id} className="hover:bg-canvas2">
                    <td className="px-5 py-3 font-medium">{u.name}</td>
                    <td className="px-5 py-3 text-inksoft">{u.email}</td>
                    <td className="px-5 py-3 text-inksoft">{roleLabel[u.role]}</td>
                    <td className="px-5 py-3 text-inksoft">{u.createdAt}</td>
                    <td className="px-5 py-3">
                      <Badge tone={u.status === "Active" ? "brand" : "neutral"}>{u.status}</Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Button
                        variant={u.status === "Active" ? "secondary" : "primary"}
                        className="px-3 py-1.5 text-xs"
                        onClick={() => toggleUserStatus(u.id)}
                      >
                        {u.status === "Active" ? "Deactivate" : "Activate"}
                      </Button>
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
