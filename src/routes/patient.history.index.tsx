import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Badge, Card, EmptyState, Input, SectionTitle, Select, statusTone } from "@/components/common/ui";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { useApp } from "@/context/AppContext";

export const Route = createFileRoute("/patient/history/")({
  head: () => ({
    meta: [
      { title: "My prediction history — DermaAI" },
      { name: "description", content: "Every scan you have run, with confidence and review status." },
      { property: "og:title", content: "My prediction history — DermaAI" },
      {
        property: "og:description",
        content: "Every scan you have run, with confidence and review status.",
      },
    ],
  }),
  component: HistoryPage,
});

function HistoryPage() {
  return (
    <DashboardLayout role="patient">
      <Inner />
    </DashboardLayout>
  );
}

function Inner() {
  const { user, predictions } = useApp();
  const [disease, setDisease] = useState("all");
  const [status, setStatus] = useState("all");
  const [minConfidence, setMinConfidence] = useState(0);
  const [date, setDate] = useState("");

  const mine = useMemo(
    () => predictions.filter((p) => p.patientId === user?.id),
    [predictions, user?.id],
  );

  const diseases = Array.from(new Set(mine.map((p) => p.disease)));

  const rows = mine.filter(
    (p) =>
      (disease === "all" || p.disease === disease) &&
      (status === "all" || p.status === status) &&
      p.confidence >= minConfidence &&
      (!date || p.date.toLowerCase().includes(date.toLowerCase())),
  );

  return (
    <>
      <SectionTitle eyebrow="History" title="My prediction history" />

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <Input placeholder="Filter by date (e.g. Sep)" value={date} onChange={(e) => setDate(e.target.value)} />
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
          <label className="text-xs text-mute">
            Min confidence: {minConfidence}%
            <input
              type="range"
              min={0}
              max={100}
              value={minConfidence}
              onChange={(e) => setMinConfidence(Number(e.target.value))}
              className="mt-2 w-full accent-brand"
            />
          </label>
        </div>
      </Card>

      {rows.length === 0 ? (
        <EmptyState title="No scans match these filters" hint="Try widening the confidence range." />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium uppercase tracking-[0.08em] text-mute">
                  <th className="px-5 py-2.5 font-medium">Date</th>
                  <th className="px-5 py-2.5 font-medium">Region</th>
                  <th className="px-5 py-2.5 font-medium">Prediction</th>
                  <th className="px-5 py-2.5 font-medium">Conf.</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 font-medium">Review</th>
                  <th className="px-5 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((p) => (
                  <tr key={p.id} className="hover:bg-canvas2">
                    <td className="px-5 py-3 text-inksoft">{p.date}</td>
                    <td className="px-5 py-3 text-inksoft">{p.region}</td>
                    <td className="px-5 py-3 font-medium">{p.disease}</td>
                    <td className="px-5 py-3 text-inksoft">{p.confidence}%</td>
                    <td className="px-5 py-3">
                      <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                    </td>
                    <td className="px-5 py-3 text-xs text-mute">
                      {p.review ? p.review.reviewedBy : "—"}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        to="/patient/history/$id"
                        params={{ id: p.id }}
                        className="text-xs font-medium text-brand hover:text-brandink"
                      >
                        View details
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
