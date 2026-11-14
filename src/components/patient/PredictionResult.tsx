import { Link } from "@tanstack/react-router";
import { Badge, Button, Card, ConfidenceRing, ProgressBar } from "@/components/common/ui";
import { ExplanationPanel } from "@/components/explainability/ExplanationPanel";
import type { Prediction } from "@/data/mockData";
import { canRequestReview, REVIEW_REASSIGN_AFTER_MS } from "@/lib/review-queue";

export function PredictionResult({
  prediction,
  threshold = 70,
  onRequestReview,
  assignedDoctorName,
  reviewRequestError,
}: {
  prediction: Prediction;
  threshold?: number;
  onRequestReview?: () => void;
  assignedDoctorName?: string | undefined;
  reviewRequestError?: string | null;
}) {
  const high = prediction.confidence >= threshold;
  const queueActive = prediction.status === "Pending Review" || prediction.status === "Review Required";
  const requestAllowed = canRequestReview(prediction);
  const daysRemaining = prediction.assignedAt === undefined
    ? null
    : Math.max(0, Math.ceil((prediction.assignedAt + REVIEW_REASSIGN_AFTER_MS - Date.now()) / (24 * 60 * 60 * 1000)));

  return (
    <Card className="p-5">
      <div className="grid gap-5 md:grid-cols-2">
        <div className="rounded-xl border border-line bg-canvas2 p-4">
          <div className="flex items-center gap-4">
            <ConfidenceRing value={prediction.confidence} />
            <div className="min-w-0">
              <div className="text-xs font-medium text-mute">AI Prediction</div>
              <div className="truncate font-display text-lg font-semibold">{prediction.disease}</div>
              <div className="mt-1">
                <Badge tone={prediction.risk === "High" ? "risk" : prediction.risk === "Moderate" ? "caution" : "brand"}>
                  <span className="size-1.5 rounded-full bg-current" /> {prediction.risk} risk
                </Badge>
              </div>
            </div>
          </div>
          <p className="mt-4 border-t border-line pt-3 text-xs text-inksoft text-pretty">
            {prediction.description}
          </p>
          <p className="mt-2 text-xs text-mute">
            Estimated confidence · requires professional confirmation.
          </p>
        </div>

        <div className="rounded-xl border border-line bg-canvas2 p-4">
          <div className="text-sm font-semibold">Ranked differential</div>
          <div className="mt-3 space-y-3">
            {prediction.differential.map((d, i) => (
              <div key={d.name}>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-inksoft">{d.name}</span>
                  <span className="font-semibold text-ink">{d.value}%</span>
                </div>
                <div className="mt-1.5">
                  <ProgressBar value={d.value} tone={i === 0 ? "brand" : "mute"} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {high ? (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl bg-brand/10 p-4">
          <div className="text-sm text-brandink">
            Confidence is above the {threshold}% review threshold. The result is displayed in full below.
          </div>
          <Link to="/patient/history" className="ml-auto">
            <Button variant="secondary">View history</Button>
          </Link>
        </div>
      ) : (
        <div className="mt-5 rounded-xl bg-caution/10 p-4">
          <div className="text-sm font-semibold text-cautionink">Prediction confidence is low.</div>
          <p className="mt-1 text-xs text-cautionink">
            This result should be reviewed by a qualified dermatologist.
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        {queueActive ? (
          <>
            <Badge tone="caution">In dermatologist queue</Badge>
            <span className="text-xs text-inksoft">
              Assigned to {assignedDoctorName ?? "a dermatologist"}
              {daysRemaining === null ? "." : ` · ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} until reassignment if unseen.`}
            </span>
          </>
        ) : requestAllowed ? (
          <Button onClick={onRequestReview}>Request dermatologist review</Button>
        ) : (
          <span className="text-xs font-medium text-mute">This report has reached its limit of 3 review requests.</span>
        )}
        <span className="text-xs text-mute">{prediction.reviewRequestCount ?? 0} of 3 requests used</span>
        {reviewRequestError ? <span role="alert" className="text-xs font-medium text-riskink">{reviewRequestError}</span> : null}
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <div className="mb-1 text-sm font-semibold">Explainable AI</div>
        <ExplanationPanel explanation={prediction.explanation} />
      </div>
    </Card>
  );
}
