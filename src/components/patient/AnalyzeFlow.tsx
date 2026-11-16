import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Badge, Button, Card, ProgressBar, Select } from "@/components/common/ui";
import { ImageUploader } from "@/components/patient/ImageUploader";
import { SKIN_CLASSES, classCode, classLabel, percentage, type SkinClassCode } from "@/lib/skin-analysis";
import { useApp } from "@/context/AppContext";
import { analyzeScan, explainScanGradcam, explainScanLime } from "@/lib/ml.functions";
import type { GradcamImages, LimeImages, ModelPrediction } from "@/lib/model-response";

const classCodes = Object.keys(SKIN_CLASSES) as SkinClassCode[];

type UploadState =
  | { phase: "idle" }
  | { phase: "uploading"; percent: number }
  | { phase: "uploaded" }
  | { phase: "failed"; error: string };

function callErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Response && error.status === 401) return "Your session has expired. Please log in again.";
  if (error instanceof TypeError) return "Cannot reach the app server. Check your connection and try again.";
  return fallback;
}

export function AnalyzeFlow() {
  const { user, patientOptions, uploadScanImage, refreshWorkspace } = useApp();
  const analyzeFn = useServerFn(analyzeScan);
  const gradcamFn = useServerFn(explainScanGradcam);
  const limeFn = useServerFn(explainScanLime);

  const [patientId, setPatientId] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [upload, setUpload] = useState<UploadState>({ phase: "idle" });
  const [prediction, setPrediction] = useState<ModelPrediction | null>(null);
  const [analysisAttempted, setAnalysisAttempted] = useState(false);
  const [predicting, setPredicting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [explainClass, setExplainClass] = useState<SkinClassCode | "">("");
  const [limeSamples, setLimeSamples] = useState<"100" | "500">("100");
  const [explanationBusy, setExplanationBusy] = useState<"gradcam" | "lime" | null>(null);
  const [explanationError, setExplanationError] = useState<string | null>(null);
  const [gradcamNotice, setGradcamNotice] = useState<string | null>(null);
  const [limeNotice, setLimeNotice] = useState<string | null>(null);
  const [gradcamResult, setGradcamResult] = useState<GradcamImages | null>(null);
  const [limeResult, setLimeResult] = useState<LimeImages | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const uploadedScan = useRef<{ file: File; scanId: string } | null>(null);
  const analyzedScanId = useRef<string | null>(null);
  const requestId = useRef(0);
  const requestInProgress = useRef(false);

  useEffect(() => {
    if (!patientId && patientOptions[0]) setPatientId(patientOptions[0].id);
  }, [patientId, patientOptions]);

  const resetResults = () => {
    setPrediction(null);
    setRequestError(null);
    setExplainClass("");
    setExplanationBusy(null);
    setExplanationError(null);
    setGradcamNotice(null);
    setLimeNotice(null);
    setGradcamResult(null);
    setLimeResult(null);
    setSaveNotice(null);
  };

  const handleImageSelected = (file: File | null, imagePreview: string | null) => {
    requestId.current += 1;
    requestInProgress.current = false;
    uploadedScan.current = null;
    analyzedScanId.current = null;
    setSelectedFile(file);
    setPreviewUrl(imagePreview);
    setUpload({ phase: "idle" });
    setAnalysisAttempted(false);
    setPredicting(false);
    resetResults();
  };

  const analyze = async (file: File) => {
    if (requestInProgress.current || analyzedScanId.current) return;
    if (!patientId) {
      setRequestError("Select a patient before analysing.");
      return;
    }
    const request = ++requestId.current;
    requestInProgress.current = true;
    setAnalysisAttempted(true);
    resetResults();

    try {
      // 1. Upload the original image (reused when retrying the same file).
      let scanId = uploadedScan.current?.file === file ? uploadedScan.current.scanId : null;
      if (!scanId) {
        setUpload({ phase: "uploading", percent: 0 });
        const uploaded = await uploadScanImage(file, patientId, (percent) => {
          if (request === requestId.current) setUpload({ phase: "uploading", percent });
        });
        if (request !== requestId.current) return;
        if (!uploaded.ok) {
          setUpload({ phase: "failed", error: uploaded.error });
          setAnalysisAttempted(false);
          return;
        }
        scanId = uploaded.scanId;
        uploadedScan.current = { file, scanId };
      }
      setUpload({ phase: "uploaded" });

      // 2. Analyse on the server (model token never reaches the browser).
      setPredicting(true);
      const result = await analyzeFn({ data: { scanId } });
      if (request !== requestId.current) return;
      if (!result.ok) {
        setRequestError(result.error);
        // Allow a retry unless the scan is already done or not ours.
        if (result.code !== "already_analyzed" && result.code !== "forbidden" && result.code !== "not_found") {
          setAnalysisAttempted(false);
        }
        return;
      }
      analyzedScanId.current = scanId;
      setPrediction(result.prediction);
      setExplainClass(classCode(result.prediction.class_name) ?? "nv");
      if (result.gradcam.status === "available") {
        setGradcamResult(result.gradcam.data);
        if (!result.gradcam.saved) setSaveNotice("Grad-CAM is shown but could not be saved to your history.");
      } else {
        setGradcamNotice(
          result.gradcam.status === "unsupported"
            ? `${result.gradcam.message} Grad-CAM is not available for this result.`
            : `Grad-CAM unavailable: ${result.gradcam.message}`,
        );
      }
      void refreshWorkspace();
    } catch (error) {
      if (request !== requestId.current) return;
      setRequestError(callErrorMessage(error, "The analysis request could not be completed. Please try again."));
      setAnalysisAttempted(false);
    } finally {
      if (request === requestId.current) {
        requestInProgress.current = false;
        setPredicting(false);
      }
    }
  };

  const explain = async (kind: "gradcam" | "lime") => {
    const scanId = analyzedScanId.current;
    if (!scanId || !explainClass || requestInProgress.current) return;
    const request = ++requestId.current;
    requestInProgress.current = true;
    setExplanationBusy(kind);
    setExplanationError(null);
    if (kind === "gradcam") {
      setGradcamResult(null);
      setGradcamNotice(null);
    } else {
      setLimeResult(null);
      setLimeNotice(null);
    }
    try {
      const result =
        kind === "gradcam"
          ? await gradcamFn({ data: { scanId, target: explainClass } })
          : await limeFn({ data: { scanId, target: explainClass, samples: Number(limeSamples) } });
      if (request !== requestId.current) return;
      if (!result.ok) {
        setExplanationError(result.error);
        return;
      }
      if (result.status === "available") {
        if (kind === "gradcam") setGradcamResult(result.data as GradcamImages);
        else setLimeResult(result.data as LimeImages);
        if (!result.saved) setSaveNotice(`${kind === "gradcam" ? "Grad-CAM" : "LIME"} is shown but could not be saved to your history.`);
        void refreshWorkspace();
      } else {
        const notice =
          result.status === "unsupported" ? result.message : `${kind === "gradcam" ? "Grad-CAM" : "LIME"} unavailable: ${result.message}`;
        if (kind === "gradcam") setGradcamNotice(notice);
        else setLimeNotice(notice);
      }
    } catch (error) {
      if (request !== requestId.current) return;
      setExplanationError(callErrorMessage(error, "The explanation request could not be completed. Please try again."));
    } finally {
      if (request === requestId.current) {
        requestInProgress.current = false;
        setExplanationBusy(null);
      }
    }
  };

  const uploading = upload.phase === "uploading";
  const busy = uploading || predicting || explanationBusy !== null;
  const probabilities = prediction
    ? classCodes
        .map((code) => ({ code, value: percentage(Number(prediction.probabilities[code]) || 0) }))
        .sort((a, b) => b.value - a.value)
    : [];
  const noPatient = user?.role === "patient" && patientOptions.length === 0;

  const patientPicker = (
    <label className="mt-3 block text-xs font-medium text-inksoft">
      Patient
      <Select
        className="mt-1"
        data-testid="patient-select"
        aria-label="Patient"
        value={patientId}
        disabled={busy || patientOptions.length === 0}
        onChange={(event) => setPatientId(event.target.value)}
      >
        {patientOptions.length === 0 ? <option value="">No patient record found</option> : null}
        {patientOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </Select>
      {noPatient ? (
        <span role="alert" className="mt-1 block text-xs font-medium text-riskink">
          Your patient record is missing. Log out and back in, or contact support.
        </span>
      ) : null}
    </label>
  );

  const uploadStatus =
    upload.phase === "uploading" ? (
      <div data-testid="upload-progress" className="mt-3" role="progressbar" aria-label="Upload progress" aria-valuenow={upload.percent} aria-valuemin={0} aria-valuemax={100}>
        <div className="mb-1 flex justify-between text-xs text-inksoft">
          <span>Uploading original image…</span>
          <span className="font-semibold tabular-nums">{upload.percent}%</span>
        </div>
        <ProgressBar value={upload.percent} tone="brand" />
      </div>
    ) : upload.phase === "uploaded" ? (
      <div data-testid="upload-success" role="status" className="mt-2 text-xs font-medium text-brand">
        Image uploaded securely.
      </div>
    ) : upload.phase === "failed" ? (
      <div data-testid="upload-failed" role="alert" className="mt-2 text-xs font-medium text-riskink">
        {upload.error}
      </div>
    ) : null;

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
            header={patientPicker}
            status={uploadStatus}
            disabled={!patientId}
          />

          <div className="rounded-xl border border-line bg-canvas2 p-4">
            {uploading || predicting ? (
              <div className="grid h-full place-items-center text-center">
                <div>
                  <div className="mx-auto size-8 animate-spin rounded-full border-2 border-line border-t-brand" />
                  <div className="mt-3 text-sm font-medium">
                    {uploading ? "Uploading skin image…" : "Analysing skin image…"}
                  </div>
                  <div className="mt-1 text-xs text-mute">
                    {uploading ? "Saving the original image to your private storage" : "Sending the image to the analysis model"}
                  </div>
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
                  {prediction.model_name || prediction.model_version ? (
                    <p className="mt-2 text-[11px] text-mute">
                      Model: {[prediction.model_name, prediction.model_version].filter(Boolean).join(" · ")}
                    </p>
                  ) : null}
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
                  setGradcamNotice(null);
                  setLimeNotice(null);
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
              {explanationBusy === "lime" ? "Running LIME…" : "Generate LIME"}
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
          {gradcamNotice ? (
            <p data-testid="gradcam-notice" role="status" className="mt-3 text-xs font-medium text-cautionink">{gradcamNotice}</p>
          ) : null}
          {limeNotice ? (
            <p data-testid="lime-notice" role="status" className="mt-3 text-xs font-medium text-cautionink">{limeNotice}</p>
          ) : null}

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

      {saveNotice ? (
        <p role="alert" className="mt-3 text-xs font-medium text-riskink">{saveNotice}</p>
      ) : null}

      <p data-testid="disclaimer" className="mt-5 border-t border-line py-4 text-xs leading-relaxed text-inksoft">
        This is a screening aid, not a diagnosis. The model can be confidently wrong, and a GREEN result does not rule out disease.
      </p>
    </>
  );
}
