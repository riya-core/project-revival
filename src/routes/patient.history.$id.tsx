import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { Card, EmptyState, SectionTitle } from "@/components/common/ui";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { PredictionResult } from "@/components/patient/PredictionResult";
import { useApp } from "@/context/AppContext";

export const Route = createFileRoute("/patient/history/$id")({
  head: () => ({
    meta: [
      { title: "Scan details — DermaAI" },
      { name: "description", content: "Full prediction, confidence and explainability for one scan." },
      { property: "og:title", content: "Scan details — DermaAI" },
      {
        property: "og:description",
        content: "Full prediction, confidence and explainability for one scan.",
      },
    ],
  }),
  component: HistoryDetail,
});

function HistoryDetail() {
  return (
    <DashboardLayout role="patient">
      <Inner />
    </DashboardLayout>
  );
}

function Inner() {
  const { id } = useParams({ from: "/patient/history/$id" });
  const { predictions, requestReview, threshold, user, users } = useApp();
  const [reviewRequestError, setReviewRequestError] = useState<string | null>(null);
  const prediction = predictions.find((p) => p.id === id && p.patientId === user?.id);

  if (!prediction) {
    return (
      <>
        <SectionTitle eyebrow="History" title="Scan not found" />
        <EmptyState title="This scan no longer exists" hint="Return to your history to pick another." />
        <Link to="/patient/history" className="text-sm font-medium text-brand hover:text-brandink">
          Back to history
        </Link>
      </>
    );
  }

  return (
    <>
      <SectionTitle
        eyebrow="Report"
        title={`${prediction.disease} · ${prediction.date}`}
        right={
          <Link to="/patient/history" className="text-sm font-medium text-brand hover:text-brandink">
            Back to history
          </Link>
        }
      />

      <PredictionResult
        prediction={prediction}
        threshold={threshold}
        assignedDoctorName={users.find((person) => person.id === prediction.assignedDoctorId)?.name}
        reviewRequestError={reviewRequestError}
        onRequestReview={async () => {
          const result = await requestReview(prediction.id);
          setReviewRequestError(result.ok ? null : result.error);
        }}
      />

      {prediction.review ? (
        <Card className="p-5">
          <div className="text-sm font-semibold">Dermatologist review</div>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-mute">Diagnosis</dt>
              <dd className="mt-1 text-inksoft">{prediction.review.diagnosis}</dd>
            </div>
            <div>
              <dt className="text-xs text-mute">Notes</dt>
              <dd className="mt-1 text-inksoft">{prediction.review.notes}</dd>
            </div>
            <div>
              <dt className="text-xs text-mute">Recommendations</dt>
              <dd className="mt-1 text-inksoft">{prediction.review.recommendations}</dd>
            </div>
          </dl>
          <div className="mt-3 text-xs text-mute">Reviewed by {prediction.review.reviewedBy}</div>
          {(prediction.reviewHistory ?? []).length > 1 ? (
            <div className="mt-4 border-t border-line pt-3">
              <div className="text-xs font-semibold text-inksoft">Previous reviews</div>
              <ul className="mt-2 space-y-2">
                {(prediction.reviewHistory ?? []).slice(0, -1).reverse().map((review, index) => (
                  <li key={`${review.reviewedById ?? review.reviewedBy}-${review.reviewedAt ?? index}`} className="text-xs text-inksoft">
                    {review.diagnosis} · {review.reviewedBy}{review.reviewedAt ? ` · ${new Date(review.reviewedAt).toLocaleDateString("en-GB")}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      ) : null}
      {prediction.reviewDraft ? (
        <Card className="p-5">
          <div className="text-sm font-semibold">Review in progress</div>
          <p className="mt-2 text-sm text-inksoft">Your dermatologist is preparing the report. The saved draft is not shown here.</p>
        </Card>
      ) : null}
    </>
  );
}
