import { createFileRoute, Link } from "@tanstack/react-router";
import { Badge, Card, ProgressBar, SectionTitle, StatCard } from "@/components/common/ui";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { useApp } from "@/context/AppContext";

export const Route = createFileRoute("/admin/dashboard")({
  head: () => ({
    meta: [
      { title: "Admin dashboard — DermaAI" },
      { name: "description", content: "System-wide usage, model accuracy and account statistics." },
      { property: "og:title", content: "Admin dashboard — DermaAI" },
      {
        property: "og:description",
        content: "System-wide usage, model accuracy and account statistics.",
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
  const { users, predictions, logs, threshold } = useApp();

  const patients = users.filter((u) => u.role === "patient").length;
  const doctors = users.filter((u) => u.role === "dermatologist").length;
  const avgConfidence = predictions.length
    ? Math.round(predictions.reduce((s, p) => s + p.confidence, 0) / predictions.length)
    : 0;

  const byDisease = predictions.reduce<Record<string, number>>((acc, p) => {
    acc[p.disease] = (acc[p.disease] ?? 0) + 1;
    return acc;
  }, {});
  const diseaseRows = Object.entries(byDisease).sort((a, b) => b[1] - a[1]);
  const maxCount = Math.max(1, ...diseaseRows.map(([, n]) => n));

  return (
    <>
      <SectionTitle
        eyebrow="Dashboard"
        title="System overview"
        right={<span className="text-sm text-mute">Mock analytics</span>}
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Total users" value={users.length} hint={`${patients} patients · ${doctors} clinicians`} />
        <StatCard label="Predictions run" value={predictions.length} hint="All time" tone="brand" />
        <StatCard label="Average confidence" value={`${avgConfidence}%`} hint={`Threshold at ${threshold}%`} />
        <StatCard
          label="Cases needing review"
          value={predictions.filter((p) => p.confidence < threshold).length}
          hint="Below confidence threshold"
          tone="caution"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <div className="text-sm font-semibold">Most common predictions</div>
          <div className="mt-4 space-y-3">
            {diseaseRows.map(([name, count]) => (
              <div key={name}>
                <div className="mb-1 flex justify-between text-xs text-inksoft">
                  <span>{name}</span>
                  <span>{count}</span>
                </div>
                <ProgressBar value={(count / maxCount) * 100} />
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <div className="text-sm font-semibold">Recent activity</div>
            <Link to="/admin/logs" className="text-xs font-medium text-brand hover:text-brandink">
              All logs
            </Link>
          </div>
          <ul className="divide-y divide-line">
            {logs.slice(0, 6).map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <div>
                  <div className="font-medium">{l.action}</div>
                  <div className="text-xs text-mute">
                    {l.user} · {l.timestamp}
                  </div>
                </div>
                <Badge tone={l.status === "Success" ? "brand" : "risk"}>{l.status}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <p className="text-xs text-mute">
        All figures come from in-browser mock data. DermaAI is an educational prototype and stores
        nothing on a server.
      </p>
    </>
  );
}
