import { SKIN_CLASSES, classCode, classLabel, percentage, toPatientReport, type SkinClassCode } from "@/lib/skin-analysis";

// Checks what the user's model service returns before anything is shown or saved.
// Shared by the server steps and tests; contains no secrets and no network calls.

export type Triage = "GREEN" | "YELLOW" | "RED";

export interface ModelPrediction {
  class_name: string;
  class_code: SkinClassCode;
  confidence: number;
  uncertainty: number;
  triage: Triage;
  message: string;
  probabilities: Record<SkinClassCode, number>;
  model_name: string | null;
  model_version: string | null;
}

export interface GradcamImages {
  class_name: string;
  probability: number;
  original: string;
  heatmap_only: string;
  overlay: string;
}

export interface LimeImages {
  class_name: string;
  probability: number;
  seconds: number;
  num_samples: number;
  original: string;
  positive_overlay: string;
  pos_neg_overlay: string;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const CLASS_CODES = Object.keys(SKIN_CLASSES) as SkinClassCode[];
const DATA_URL = /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/]+=*$/;
const MAX_DATA_URL_LENGTH = 12 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isTriage(value: unknown): value is Triage {
  return value === "GREEN" || value === "YELLOW" || value === "RED";
}

/** A probability given either as 0–1 or as a 0–100 percentage. */
function isProbability(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 100;
}

function optionalText(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

export function isImageDataUrl(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_DATA_URL_LENGTH && DATA_URL.test(value);
}

export function parsePrediction(payload: unknown): Parsed<ModelPrediction> {
  const invalid = { ok: false as const, error: "The model returned an invalid prediction." };
  if (!isRecord(payload)) return invalid;
  const className = payload["class_name"];
  const code = typeof className === "string" ? classCode(className) : null;
  const probabilities = payload["probabilities"];
  if (
    !code ||
    typeof payload["message"] !== "string" ||
    !isTriage(payload["triage"]) ||
    !isProbability(payload["confidence"]) ||
    !isFiniteNumber(payload["uncertainty"]) ||
    payload["uncertainty"] < 0 ||
    !isRecord(probabilities) ||
    !CLASS_CODES.every((item) => isProbability(probabilities[item]))
  ) {
    return invalid;
  }
  return {
    ok: true,
    value: {
      class_name: code,
      class_code: code,
      confidence: payload["confidence"],
      uncertainty: payload["uncertainty"],
      triage: payload["triage"],
      message: payload["message"].slice(0, 2000),
      probabilities: Object.fromEntries(CLASS_CODES.map((item) => [item, Number(probabilities[item])])) as Record<
        SkinClassCode,
        number
      >,
      model_name: optionalText(payload["model_name"], 120),
      model_version: optionalText(payload["model_version"], 60),
    },
  };
}

export function parseGradcam(payload: unknown): Parsed<GradcamImages> {
  if (
    !isRecord(payload) ||
    typeof payload["class_name"] !== "string" ||
    !isProbability(payload["probability"]) ||
    !isImageDataUrl(payload["original"]) ||
    !isImageDataUrl(payload["heatmap_only"]) ||
    !isImageDataUrl(payload["overlay"])
  ) {
    return { ok: false, error: "The model returned an invalid Grad-CAM result." };
  }
  return {
    ok: true,
    value: {
      class_name: payload["class_name"],
      probability: payload["probability"],
      original: payload["original"],
      heatmap_only: payload["heatmap_only"],
      overlay: payload["overlay"],
    },
  };
}

export function parseLime(payload: unknown): Parsed<LimeImages> {
  if (
    !isRecord(payload) ||
    typeof payload["class_name"] !== "string" ||
    !isProbability(payload["probability"]) ||
    !isFiniteNumber(payload["seconds"]) ||
    !isFiniteNumber(payload["num_samples"]) ||
    !isImageDataUrl(payload["original"]) ||
    !isImageDataUrl(payload["positive_overlay"]) ||
    !isImageDataUrl(payload["pos_neg_overlay"])
  ) {
    return { ok: false, error: "The model returned an invalid LIME result." };
  }
  return {
    ok: true,
    value: {
      class_name: payload["class_name"],
      probability: payload["probability"],
      seconds: payload["seconds"],
      num_samples: payload["num_samples"],
      original: payload["original"],
      positive_overlay: payload["positive_overlay"],
      pos_neg_overlay: payload["pos_neg_overlay"],
    },
  };
}

/** Statuses that mean "this model does not offer that feature". */
export function isUnsupportedStatus(status: number): boolean {
  return status === 404 || status === 405 || status === 501;
}

export function modelErrorMessage(status: number, payload: unknown): string {
  if (status === 401 || status === 403) return "The model service rejected the access token. Check HF_API_TOKEN.";
  if (status === 503 || status === 502 || status === 504) {
    return "The model service is starting up or unavailable. Please try again in a minute.";
  }
  if (isRecord(payload)) {
    const detail = payload["detail"] ?? payload["error"];
    if (typeof detail === "string" && detail.trim()) return detail.trim().slice(0, 200);
  }
  return `The model service returned an error (${status}).`;
}

/** Fields written to the scan once the model result is valid. */
export function scanFieldsFromPrediction(prediction: ModelPrediction, fallbackModelName: string) {
  const report = toPatientReport(prediction, { id: "", name: "" }, "");
  return {
    prediction: classLabel(prediction.class_name).slice(0, 120),
    confidence: Math.min(100, Math.max(0, Math.round(percentage(prediction.confidence) * 1000) / 1000)),
    uncertainty: prediction.uncertainty,
    model_name: prediction.model_name ?? fallbackModelName.slice(0, 120),
    model_version: prediction.model_version,
    status: report.status,
    triage: prediction.triage,
    risk: report.risk,
    description: report.description,
    probabilities: prediction.probabilities,
    differential: report.differential,
    explanation: report.explanation,
  };
}
