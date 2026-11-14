import { createFileRoute, Link } from "@tanstack/react-router";
import { Badge, Card, SectionTitle, StatCard, statusTone } from "@/components/common/ui";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { AnalyzeFlow } from "@/components/patient/AnalyzeFlow";
import { useApp } from "@/context/AppContext";

export const Route = createFileRoute("/patient/dashboard")({
  head: () => ({
    meta: [
      { title: "Patient dashboard — DermaAI" },
      { name: "description", content: "Your scans, confidence scores and skin analysis workspace." },
      { property: "og:title", content: "Patient dashboard — DermaAI" },
      {
        property: "og:description",
        content: "Your scans, confidence scores and skin analysis workspace.",
      },
    ],
  }),
  component: PatientDashboard,
});

function PatientDashboard() {
  return (
    <DashboardLayout role="patient">
      <Inner />
    </DashboardLayout>
  );
}

function Inner() {
  const { user, predictions } = useApp();
  const mine = predictions.filter((p) => p.patientId === user?.id);
  const avg = mine.length
    ? Math.round(mine.reduce((sum, p) => sum + p.confidence, 0) / mine.length)
    : 0;
  const last = mine[0];

  return (
    <>
      <SectionTitle
        eyebrow="Dashboard"
        title={`Welcome back, ${user?.name.split(" ")[0] ?? "there"}`}
        right={<span className="text-sm text-mute">Patient overview</span>}
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Total scans" value={mine.length} hint="Across all uploads" />
        <StatCard
          label="Last prediction"
          value={last ? last.disease : "—"}
          hint={last ? `${last.date} · ${last.confidence}%` : "No scans yet"}
          tone="brand"
        />
        <StatCard label="Average confidence" value={`${avg}%`} hint="Mock model output" />
        <StatCard
          label="Reports"
          value={mine.filter((p) => p.review).length}
          hint="Reviewed by a dermatologist"
          tone="caution"
        />
      </div>

      <SectionTitle title="Analyze your skin" />
      <AnalyzeFlow />

      <Card>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div className="text-sm font-semibold">Recent scans</div>
          <Link to="/patient/history" className="text-xs font-medium text-brand hover:text-brandink">
            View all
          </Link>
        </div>
        {mine.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-mute">
            No scans yet — upload an image above to get started.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium uppercase tracking-[0.08em] text-mute">
                  <th className="px-5 py-2.5 font-medium">Date</th>
                  <th className="px-5 py-2.5 font-medium">Prediction</th>
                  <th className="px-5 py-2.5 font-medium">Conf.</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {mine.slice(0, 4).map((p) => (
                  <tr key={p.id} className="hover:bg-canvas2">
                    <td className="px-5 py-3 text-inksoft">{p.date}</td>
                    <td className="px-5 py-3 font-medium">{p.disease}</td>
                    <td className="px-5 py-3 text-inksoft">{p.confidence}%</td>
                    <td className="px-5 py-3">
                      <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
