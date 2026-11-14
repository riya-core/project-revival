import { createFileRoute, Link } from "@tanstack/react-router";
import { Badge, Card, SectionTitle, StatCard, statusTone } from "@/components/common/ui";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { useApp } from "@/context/AppContext";
import { REVIEW_REASSIGN_AFTER_MS, sortReviewQueue } from "@/lib/review-queue";

export const Route = createFileRoute("/dermatologist/dashboard")({
  head: () => ({
    meta: [
      { title: "Dermatologist dashboard — DermaAI" },
      { name: "description", content: "Review queue, patient load and low-confidence AI cases." },
      { property: "og:title", content: "Dermatologist dashboard — DermaAI" },
      {
        property: "og:description",
        content: "Review queue, patient load and low-confidence AI cases.",
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
  const { user, predictions, threshold, users } = useApp();

  const pending = sortReviewQueue(predictions.filter(
    (p) => (p.status === "Pending Review" || p.status === "Review Required") && p.assignedDoctorId === user?.id,
  ));
  const reviewed = predictions.filter((p) => p.status === "Reviewed");
  const lowConfidence = predictions.filter((p) => p.confidence < threshold);
  const patients = new Set(predictions.map((p) => p.patientId)).size;

  return (
    <>
      <SectionTitle
        eyebrow="Dashboard"
        title={`Good to see you, ${user?.name.split(" ").slice(-1)[0] ?? "Doctor"}`}
        right={<span className="text-sm text-mute">Clinical review overview</span>}
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Pending reviews" value={pending.length} hint="Awaiting your opinion" tone="caution" />
        <StatCard label="Reviewed cases" value={reviewed.length} hint="Completed by clinicians" tone="brand" />
        <StatCard label="Low confidence" value={lowConfidence.length} hint={`Below ${threshold}% threshold`} />
        <StatCard label="Patients seen" value={patients} hint="Unique patients in system" />
      </div>

      <Card>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div className="text-sm font-semibold">Review queue</div>
          <Link to="/dermatologist/reports" className="text-xs font-medium text-brand hover:text-brandink">
            All reports
          </Link>
        </div>
        {pending.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-mute">
            Nothing waiting — the queue is clear.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium uppercase tracking-[0.08em] text-mute">
                  <th className="px-5 py-2.5 font-medium">Patient</th>
                  <th className="px-5 py-2.5 font-medium">Date</th>
                  <th className="px-5 py-2.5 font-medium">AI prediction</th>
                  <th className="px-5 py-2.5 font-medium">Conf.</th>
                  <th className="px-5 py-2.5 font-medium">Priority</th>
                  <th className="px-5 py-2.5 font-medium">Assigned / due</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {pending.map((p) => (
                  <tr key={p.id} className="hover:bg-canvas2">
                    <td className="px-5 py-3 font-medium">{p.patientName}</td>
                    <td className="px-5 py-3 text-inksoft">{p.date}</td>
                    <td className="px-5 py-3 text-inksoft">{p.disease}</td>
                    <td className="px-5 py-3 text-inksoft">{p.confidence}%</td>
                    <td className="px-5 py-3 text-inksoft">{p.queuePriority ?? "Standard"}</td>
                    <td className="px-5 py-3 text-xs text-inksoft">
                      {users.find((person) => person.id === p.assignedDoctorId)?.name ?? "Unassigned"}
                      {p.assignedAt !== undefined ? (
                        <div>
                          {Math.max(0, Math.ceil((p.assignedAt + REVIEW_REASSIGN_AFTER_MS - Date.now()) / 86_400_000))} days left
                        </div>
                      ) : null}
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
                        Open case
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-xs text-mute">
        Predictions are produced by a simulated model for demonstration only. Clinical judgement
        always overrides the AI output.
      </p>
    </>
  );
}
