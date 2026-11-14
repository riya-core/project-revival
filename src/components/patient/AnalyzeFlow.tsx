import { useRef, useState } from "react";
import { Badge, Button, Card, ProgressBar, Select } from "@/components/common/ui";
import { ImageUploader } from "@/components/patient/ImageUploader";
import { SKIN_CLASSES, classCode, classLabel, percentage, toPatientReport, type SkinClassCode } from "@/lib/skin-analysis";
import { useApp } from "@/context/AppContext";

type Triage = "GREEN" | "YELLOW" | "RED";
type PredictionResponse = {
  class_name: string;
  class_index: number;
  confidence: number;
  uncertainty: number;
  triage: Triage;
  message: string;
  probabilities: Record<string, number>;
};
type GradcamResponse = {
  class_name: string;
  probability: number;
  original: string;
  heatmap_only: string;
  overlay: string;
};
type LimeResponse = {
  class_name: string;
  probability: number;
  seconds: number;
  num_samples: number;
  original: string;
  positive_overlay: string;
  pos_neg_overlay: string;
};

const API_BASE_URL = (import.meta.env["VITE_API_URL"] || "http://localhost:8000").replace(/\/+$/, "");
const classCodes = Object.keys(SKIN_CLASSES) as SkinClassCode[];

async function readResponse<T>(response: Response): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("The analysis server returned an unreadable response.");
  }
  if (!response.ok) {
    const detail =
      typeof payload === "object" && payload !== null && "detail" in payload &&
      typeof payload.detail === "string"
        ? payload.detail
        : `The analysis request failed (${response.status}).`;
    throw new Error(detail);
  }
  return payload as T;
}

function isTriage(value: string): value is Triage {
  return value === "GREEN" || value === "YELLOW" || value === "RED";
}

export function AnalyzeFlow() {
  const { user, addPrediction } = useApp();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [prediction, setPrediction] = useState<PredictionResponse | null>(null);
  const [analysisAttempted, setAnalysisAttempted] = useState(false);
  const [predicting, setPredicting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [explainClass, setExplainClass] = useState<SkinClassCode | "">("");
  const [limeSamples, setLimeSamples] = useState<"100" | "500">("100");
  const [explanationBusy, setExplanationBusy] = useState<"gradcam" | "lime" | null>(null);
  const [explanationError, setExplanationError] = useState<string | null>(null);
  const [gradcamResult, setGradcamResult] = useState<GradcamResponse | null>(null);
  const [limeResult, setLimeResult] = useState<LimeResponse | null>(null);
  const requestId = useRef(0);
  const activeController = useRef<AbortController | null>(null);
  const requestInProgress = useRef(false);
  const analyzedFile = useRef<File | null>(null);

  const handleImageSelected = (file: File | null, imagePreview: string | null) => {
    requestId.current += 1;
    activeController.current?.abort();
    activeController.current = null;
    requestInProgress.current = false;
    analyzedFile.current = null;
    setSelectedFile(file);
    setPreviewUrl(imagePreview);
    setPrediction(null);
    setAnalysisAttempted(false);
    setPredicting(false);
    setRequestError(null);
    setExplainClass("");
    setExplanationBusy(null);
    setExplanationError(null);
    setGradcamResult(null);
    setLimeResult(null);
  };

  const analyze = async (file: File) => {
    if (requestInProgress.current || analyzedFile.current === file) return;
    const request = ++requestId.current;
    const controller = new AbortController();
    activeController.current = controller;
    requestInProgress.current = true;
    setAnalysisAttempted(true);
    setPredicting(true);
    setRequestError(null);
    setPrediction(null);
    const body = new FormData();
    body.append("file", file);
    try {
      const response = await fetch(`${API_BASE_URL}/predict`, {
        method: "POST",
        body,
        signal: controller.signal,
      });
      const data = await readResponse<PredictionResponse>(response);
      if (request !== requestId.current) return;
      if (
        typeof data.class_name !== "string" ||
        typeof data.message !== "string" ||
        !isTriage(data.triage) ||
        typeof data.confidence !== "number" ||
        !Number.isFinite(data.confidence) ||
        typeof data.uncertainty !== "number" ||
        !Number.isFinite(data.uncertainty) ||
        !data.probabilities ||
        !classCodes.every((code) => Number.isFinite(data.probabilities[code]))
      ) {
        throw new Error("The analysis server returned an invalid prediction.");
      }
      setPrediction(data);
      if (user?.role === "patient") {
        addPrediction(toPatientReport(data, { id: user.id, name: user.name }, crypto.randomUUID()));
      }
      setExplainClass(classCode(data.class_name) ?? "nv");
      analyzedFile.current = file;
    } catch (error) {
      if (request !== requestId.current || (error instanceof DOMException && error.name === "AbortError")) return;
      setRequestError(
        error instanceof TypeError
          ? "Cannot reach the analysis server. Is it running?"
          : error instanceof Error
            ? error.message
            : "The analysis request could not be completed.",
      );
    } finally {
      if (request === requestId.current) {
        requestInProgress.current = false;
        activeController.current = null;
        setPredicting(false);
      }
    }
  };

  const explain = async (kind: "gradcam" | "lime") => {
    if (!selectedFile || !explainClass || requestInProgress.current) return;
    const request = ++requestId.current;
    const controller = new AbortController();
    activeController.current = controller;
    requestInProgress.current = true;
    setExplanationBusy(kind);
    setExplanationError(null);
    if (kind === "gradcam") setGradcamResult(null);
    else setLimeResult(null);
    const body = new FormData();
    body.append("file", selectedFile);
    body.append("target", explainClass);
    if (kind === "lime") body.append("samples", limeSamples);
    try {
      const response = await fetch(`${API_BASE_URL}/explain/${kind}`, {
        method: "POST",
        body,
        signal: controller.signal,
      });
      if (kind === "gradcam") {
        const data = await readResponse<GradcamResponse>(response);
        if (request === requestId.current) setGradcamResult(data);
      } else {
        const data = await readResponse<LimeResponse>(response);
        if (request === requestId.current) setLimeResult(data);
      }
    } catch (error) {
      if (request !== requestId.current || (error instanceof DOMException && error.name === "AbortError")) return;
      setExplanationError(
        error instanceof TypeError
          ? "Cannot reach the analysis server. Is it running?"
          : error instanceof Error
            ? error.message
            : "The explanation request could not be completed.",
      );
    } finally {
      if (request === requestId.current) {
        requestInProgress.current = false;
        activeController.current = null;
        setExplanationBusy(null);
      }
    }
  };

  const busy = predicting || explanationBusy !== null;
  const probabilities = prediction
    ? classCodes
        .map((code) => ({ code, value: percentage(Number(prediction.probabilities[code]) || 0) }))
        .sort((a, b) => b.value - a.value)
    : [];

  return (
    <>
      <Card className="p-5">
        <div className="grid gap-5 md:grid-cols-2">
          <ImageUploader
            onAnalyze={analyze}
            onImageSelected={handleImageSelected}
            analyzing={busy}
            analysisAttempted={analysisAttempted}
            hasPrediction={prediction !== null}
          />

          <div className="rounded-xl border border-line bg-canvas2 p-4">
            {predicting ? (
              <div className="grid h-full place-items-center text-center">
                <div>
                  <div className="mx-auto size-8 animate-spin rounded-full border-2 border-line border-t-brand" />
                  <div className="mt-3 text-sm font-medium">Analysing skin image…</div>
                  <div className="mt-1 text-xs text-mute">Sending the image to the analysis server</div>
                </div>
              </div>
            ) : requestError ? (
              <div role="alert" className="grid h-full place-items-center text-center text-sm font-medium text-riskink">
                {requestError}
              </div>
            ) : prediction ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge
                    tone={prediction.triage === "GREEN" ? "brand" : prediction.triage === "YELLOW" ? "caution" : "risk"}
                  >
                    <span data-testid="triage-badge" className="text-base font-bold">{prediction.triage}</span>
                  </Badge>
                  <p className="min-w-0 flex-1 text-sm font-medium text-ink">{prediction.message}</p>
                </div>
                <div className="border-t border-line pt-3">
                  <div className="text-xs font-medium text-mute">Predicted disease</div>
                  <div data-testid="predicted-class" className="mt-1 font-display text-xl font-semibold">
                    {classLabel(prediction.class_name)}
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-lg bg-surface p-3">
                      <div className="text-xs text-mute">Confidence</div>
                      <div data-testid="confidence" className="mt-1 text-lg font-semibold">
                        {percentage(prediction.confidence).toFixed(1)}%
                      </div>
                    </div>
                    <div className="rounded-lg bg-surface p-3">
                      <div className="text-xs text-mute">Uncertainty (std over 50 MC Dropout passes)</div>
                      <div data-testid="uncertainty" className="mt-1 text-lg font-semibold">
                        {prediction.uncertainty.toFixed(3)}
                      </div>
                    </div>
                  </div>
                </div>
                <div data-testid="probability-bars" className="border-t border-line pt-3">
                  <div className="mb-3 text-sm font-semibold">Class probabilities</div>
                  <div className="space-y-3">
                    {probabilities.map(({ code, value }) => (
                      <div key={code}>
                        <div className="mb-1 flex justify-between gap-3 text-xs">
                          <span>{SKIN_CLASSES[code]}</span>
                          <span className="font-semibold tabular-nums">{value.toFixed(1)}%</span>
                        </div>
                        <ProgressBar value={value} tone="brand" />
                      </div>
                    ))}
                  </div>
                </div>
                <p data-testid="expert-warning" className="border-t border-line pt-3 text-xs font-semibold text-cautionink">
                  {prediction.triage === "GREEN"
                    ? "A GREEN result does not rule out disease."
                    : "Low confidence: please consult a dermatologist."}
                </p>
              </div>
            ) : (
              <div className="grid h-full place-items-center text-center text-xs text-mute">
                Your triage result, confidence and class probabilities will appear here.
              </div>
            )}
          </div>
        </div>
      </Card>

      {prediction && previewUrl ? (
        <Card className="mt-5 p-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-sm font-semibold">Explainability</div>
              <p className="mt-1 text-xs text-mute">Explore the regions that influenced this model result.</p>
            </div>
            <label className="w-full max-w-xs text-xs font-medium text-inksoft">
              Explain class
              <Select
                className="mt-1"
                value={explainClass}
                onChange={(event) => {
                  setExplainClass(event.target.value as SkinClassCode);
                  setGradcamResult(null);
                  setLimeResult(null);
                  setExplanationError(null);
                }}
                aria-label="Explain class"
                disabled={busy}
              >
                {classCodes.map((code) => (
                  <option key={code} value={code}>{SKIN_CLASSES[code]}</option>
                ))}
              </Select>
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <Button data-testid="gradcam-btn" disabled={busy} onClick={() => explain("gradcam")}>
              {explanationBusy === "gradcam" ? "Loading Grad-CAM…" : "Show Grad-CAM"}
            </Button>
            <label className="text-xs font-medium text-inksoft">
              LIME samples
              <Select
                className="mt-1 min-w-36"
                value={limeSamples}
                disabled={busy}
                onChange={(event) => setLimeSamples(event.target.value as "100" | "500")}
                aria-label="LIME samples"
              >
                <option value="100">Fast · 100 samples</option>
                <option value="500">Standard · 500 samples</option>
              </Select>
            </label>
            <Button data-testid="lime-btn" disabled={busy} onClick={() => explain("lime")}>
              {explanationBusy === "lime" ? "Running LIME…" : "Show LIME"}
            </Button>
          </div>

          {explanationBusy === "lime" ? (
            <div className="mt-4" role="progressbar" aria-label="LIME analysis progress" aria-valuetext="Running">
              <p className="mb-2 text-xs text-inksoft">Running LIME, this can take 1-2 minutes</p>
              <div className="h-2 overflow-hidden rounded-full bg-line">
                <div className="h-full w-1/3 animate-pulse rounded-full bg-brand" />
              </div>
            </div>
          ) : null}
          {explanationError ? <p role="alert" className="mt-3 text-xs font-medium text-riskink">{explanationError}</p> : null}

          {gradcamResult ? (
            <section data-testid="gradcam-result" className="mt-5 border-t border-line pt-4">
              <div className="mb-3 text-sm font-semibold">
                Grad-CAM · {classLabel(gradcamResult.class_name)} · {percentage(gradcamResult.probability).toFixed(1)}%
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  { label: "Input", src: gradcamResult.original },
                  { label: "Heatmap", src: gradcamResult.heatmap_only },
                  { label: "Overlay", src: gradcamResult.overlay },
                ].map((image) => (
                  <figure key={image.label}>
                    <img src={image.src} alt={`${image.label} for ${classLabel(gradcamResult.class_name)}`} className="aspect-square w-full rounded-lg border border-line object-cover" />
                    <figcaption className="mt-1.5 text-center text-xs text-inksoft">{image.label}</figcaption>
                  </figure>
                ))}
              </div>
            </section>
          ) : null}

          {limeResult ? (
            <section data-testid="lime-result" className="mt-5 border-t border-line pt-4">
              <div className="mb-3 text-sm font-semibold">
                LIME · {classLabel(limeResult.class_name)} · {percentage(limeResult.probability).toFixed(1)}%
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  { label: "Input", src: limeResult.original },
                  { label: "Regions supporting the class", src: limeResult.positive_overlay },
                  { label: "Green = for, red = against", src: limeResult.pos_neg_overlay },
                ].map((image) => (
                  <figure key={image.label}>
                    <img src={image.src} alt={`${image.label} for ${classLabel(limeResult.class_name)}`} className="aspect-square w-full rounded-lg border border-line object-cover" />
                    <figcaption className="mt-1.5 text-center text-xs text-inksoft">{image.label}</figcaption>
                  </figure>
                ))}
              </div>
              <p className="mt-3 text-xs text-mute">
                {limeResult.seconds.toFixed(2)} seconds · {limeResult.num_samples} samples
              </p>
            </section>
          ) : null}
        </Card>
      ) : null}

      <p data-testid="disclaimer" className="mt-5 border-t border-line py-4 text-xs leading-relaxed text-inksoft">
        This is a screening aid, not a diagnosis. The model can be confidently wrong, and a GREEN result does not rule out disease.
      </p>
    </>
  );
}
