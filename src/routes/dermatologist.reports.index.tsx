import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Badge, Card, EmptyState, Input, SectionTitle, Select, StatCard, statusTone } from "@/components/common/ui";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { useApp } from "@/context/AppContext";
import { REVIEW_REASSIGN_AFTER_MS } from "@/lib/review-queue";

export const Route = createFileRoute("/dermatologist/reports/")({
  head: () => ({
    meta: [
      { title: "Patient reports — DermaAI" },
      { name: "description", content: "Browse and filter every AI-generated skin report for review." },
      { property: "og:title", content: "Patient reports — DermaAI" },
      {
        property: "og:description",
        content: "Browse and filter every AI-generated skin report for review.",
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
  const { predictions, user, users } = useApp();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [disease, setDisease] = useState("all");

  const diseases = Array.from(new Set(predictions.map((p) => p.disease)));

  const rows = predictions.filter(
    (p) =>
      p.assignedDoctorId === user?.id &&
      (status === "all" || p.status === status) &&
      (disease === "all" || p.disease === disease) &&
      (!query || p.patientName.toLowerCase().includes(query.toLowerCase())),
  );

  return (
    <>
      <SectionTitle eyebrow="Reports" title="Patient reports" />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label="My open queue" value={predictions.filter((p) => p.assignedDoctorId === user?.id && (p.status === "Pending Review" || p.status === "Review Required")).length} />
        <StatCard label="My completed reviews" value={predictions.filter((p) => p.review?.reviewedById === user?.id).length} tone="brand" />
        <StatCard label="Active dermatologists" value={users.filter((person) => person.role === "dermatologist" && person.status === "Active").length} />
      </div>

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Input
            placeholder="Search patient name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Select value={disease} onChange={(e) => setDisease(e.target.value)}>
            <option value="all">All conditions</option>
            {diseases.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="Completed">Completed</option>
            <option value="Review Required">Review Required</option>
            <option value="Pending Review">Pending Review</option>
            <option value="Reviewed">Reviewed</option>
          </Select>
        </div>
      </Card>

      {rows.length === 0 ? (
        <EmptyState title="No reports match these filters" hint="Try clearing the search field." />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium uppercase tracking-[0.08em] text-mute">
                  <th className="px-5 py-2.5 font-medium">Patient</th>
                  <th className="px-5 py-2.5 font-medium">Date</th>
                  <th className="px-5 py-2.5 font-medium">Region</th>
                  <th className="px-5 py-2.5 font-medium">AI prediction</th>
                  <th className="px-5 py-2.5 font-medium">Conf.</th>
                  <th className="px-5 py-2.5 font-medium">Priority</th>
                  <th className="px-5 py-2.5 font-medium">Request / due</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((p) => (
                  <tr key={p.id} className="hover:bg-canvas2">
                    <td className="px-5 py-3 font-medium">{p.patientName}</td>
                    <td className="px-5 py-3 text-inksoft">{p.date}</td>
                    <td className="px-5 py-3 text-inksoft">{p.region}</td>
                    <td className="px-5 py-3 text-inksoft">{p.disease}</td>
                    <td className="px-5 py-3 text-inksoft">{p.confidence}%</td>
                    <td className="px-5 py-3 text-inksoft">{p.queuePriority ?? "—"}</td>
                    <td className="px-5 py-3 text-xs text-inksoft">
                      {p.reviewRequestCount ?? 0} request{p.reviewRequestCount === 1 ? "" : "s"}
                      {p.assignedAt !== undefined ? (
                        <div>{Math.max(0, Math.ceil((p.assignedAt + REVIEW_REASSIGN_AFTER_MS - Date.now()) / 86_400_000))} days left</div>
                      ) : null}
                      <div>{users.find((person) => person.id === p.assignedDoctorId)?.name ?? "Unassigned"}</div>
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        to="/dermatologist/reports/$id"
                        params={{ id: p.id }}
                        className="text-xs font-medium text-brand hover:text-brandink"
                      >
                        Review
                      </Link>
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
