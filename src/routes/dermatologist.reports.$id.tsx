import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  ConfidenceRing,
  EmptyState,
  Field,
  Input,
  ProgressBar,
  SectionTitle,
  Textarea,
  statusTone,
} from "@/components/common/ui";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { ExplanationPanel } from "@/components/explainability/ExplanationPanel";
import { useApp } from "@/context/AppContext";

export const Route = createFileRoute("/dermatologist/reports/$id")({
  head: () => ({
    meta: [
      { title: "Case review — DermaAI" },
      { name: "description", content: "Inspect the AI prediction, explanations and record a diagnosis." },
      { property: "og:title", content: "Case review — DermaAI" },
      {
        property: "og:description",
        content: "Inspect the AI prediction, explanations and record a diagnosis.",
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
  const { id } = useParams({ from: "/dermatologist/reports/$id" });
  const { predictions, saveDiagnosis, markCaseSeen, user, users } = useApp();
  const prediction = predictions.find((p) => p.id === id);

  const [diagnosis, setDiagnosis] = useState(prediction?.reviewDraft?.diagnosis ?? prediction?.disease ?? "");
  const [notes, setNotes] = useState(prediction?.reviewDraft?.notes ?? "");
  const [recommendations, setRecommendations] = useState(prediction?.reviewDraft?.recommendations ?? "");
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    markCaseSeen(id);
  }, [id, markCaseSeen]);

  if (!prediction) {
    return (
      <>
        <SectionTitle eyebrow="Reports" title="Case not found" />
        <EmptyState title="This report no longer exists" hint="Pick another case from the list." />
        <Link to="/dermatologist/reports" className="text-sm font-medium text-brand hover:text-brandink">
          Back to reports
        </Link>
      </>
    );
  }

  if (user?.role !== "dermatologist" || prediction.assignedDoctorId !== user.id) {
    return (
      <>
        <SectionTitle eyebrow="Reports" title="This case is assigned elsewhere" />
        <EmptyState title="You don’t have this case in your queue" hint="Cases can only be reviewed by their assigned dermatologist." />
        <Link to="/dermatologist/reports" className="text-sm font-medium text-brand hover:text-brandink">Back to my reports</Link>
      </>
    );
  }

  async function handleSave(markReviewed: boolean) {
    const success = await saveDiagnosis(id, { diagnosis, notes, recommendations }, markReviewed);
    setSaved(success);
    setSaveError(success ? null : "This case is no longer assigned to you.");
    if (success) setTimeout(() => setSaved(false), 2500);
  }

  return (
    <>
      <SectionTitle
        eyebrow="Case review"
        title={`${prediction.patientName} · ${prediction.date}`}
        right={
          <Link to="/dermatologist/reports" className="text-sm font-medium text-brand hover:text-brandink">
            Back to reports
          </Link>
        }
      />

      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-5">
          <ConfidenceRing value={prediction.confidence} />
          <div className="min-w-[200px] flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-xl font-semibold">{prediction.disease}</h2>
              <Badge tone={statusTone(prediction.status)}>{prediction.status}</Badge>
              <Badge tone={prediction.risk === "High" ? "risk" : prediction.risk === "Moderate" ? "caution" : "brand"}>
                {prediction.risk} risk
              </Badge>
            </div>
            <p className="mt-2 text-sm text-inksoft">{prediction.description}</p>
            <div className="mt-2 text-xs text-mute">Affected region: {prediction.region}</div>
            <div className="mt-2 text-xs text-mute">
              Request {prediction.reviewRequestCount ?? 0} of 3 · Priority {prediction.queuePriority ?? "Standard"} · Assigned to {users.find((person) => person.id === prediction.assignedDoctorId)?.name ?? "you"}
            </div>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          <div className="text-sm font-semibold">Differential probabilities</div>
          {prediction.differential.map((d) => (
            <div key={d.name}>
              <div className="mb-1 flex justify-between text-xs text-inksoft">
                <span>{d.name}</span>
                <span>{d.value}%</span>
              </div>
              <ProgressBar value={d.value} tone={d.name === prediction.disease ? "brand" : "mute"} />
            </div>
          ))}
        </div>
      </Card>

      <ExplanationPanel explanation={prediction.explanation} />

      <Card className="p-5">
        <div className="text-sm font-semibold">Clinical diagnosis</div>
        <div className="mt-4 grid gap-4">
          <Field label="Confirmed diagnosis">
            <Input value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} />
          </Field>
          <Field label="Clinical notes">
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Observations, dermoscopic findings, history…"
            />
          </Field>
          <Field label="Recommendations">
            <Textarea
              rows={3}
              value={recommendations}
              onChange={(e) => setRecommendations(e.target.value)}
              placeholder="Treatment plan, follow-up interval, referrals…"
            />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => handleSave(true)}>Save & mark reviewed</Button>
            <Button variant="secondary" onClick={() => handleSave(false)}>
              Save draft
            </Button>
            {saved ? <span className="text-sm font-medium text-brandink">Diagnosis saved</span> : null}
            {saveError ? <span role="alert" className="text-sm font-medium text-riskink">{saveError}</span> : null}
          </div>
        </div>
      </Card>

      {prediction.review ? (
        <Card className="p-5">
          <div className="text-sm font-semibold">Latest saved review</div>
          <p className="mt-2 text-sm text-inksoft">
            {prediction.review.diagnosis} — reviewed by {prediction.review.reviewedBy}
          </p>
        </Card>
      ) : null}
    </>
  );
}
