import type { Prediction } from "@/data/mockData";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const BLUR_THRESHOLD = 100;

export const SKIN_CLASSES = {
  akiec: "Actinic keratosis",
  bcc: "Basal cell carcinoma",
  bkl: "Benign keratosis",
  df: "Dermatofibroma",
  mel: "Melanoma",
  nv: "Melanocytic nevus",
  vasc: "Vascular lesion",
} as const;

export type SkinClassCode = keyof typeof SKIN_CLASSES;

export function validateImageFile(file: Pick<File, "name" | "type" | "size">): string | null {
  const hasSupportedType = ["image/jpeg", "image/jpg", "image/png"].includes(file.type);
  const hasSupportedExtension = /\.(jpe?g|png)$/i.test(file.name);
  if (!hasSupportedExtension || (!hasSupportedType && file.type !== "")) {
    return "Unsupported file. Please upload a JPG or PNG skin image.";
  }
  if (file.size > MAX_IMAGE_BYTES) return "Image must be 10 MB or smaller.";
  return null;
}

export function classLabel(code: string): string {
  const normalized = code.toLowerCase().trim();
  return normalized in SKIN_CLASSES
    ? SKIN_CLASSES[normalized as SkinClassCode]
    : code;
}

export function classCode(value: string): SkinClassCode | null {
  const normalized = value.toLowerCase().trim();
  const code = classCodes.find((item) => item === normalized);
  if (code) return code;
  return classCodes.find((item) => SKIN_CLASSES[item].toLowerCase() === normalized) ?? null;
}

const classCodes = Object.keys(SKIN_CLASSES) as SkinClassCode[];

export function percentage(value: number): number {
  return value <= 1 ? value * 100 : value;
}

export interface ModelPredictionResult {
  class_name: string;
  confidence: number;
  triage: "GREEN" | "YELLOW" | "RED";
  message: string;
  probabilities: Record<string, number>;
}

export function toPatientReport(
  result: ModelPredictionResult,
  patient: { id: string; name: string },
  id: string,
  now = Date.now(),
): Prediction {
  const disease = classLabel(result.class_name);
  const differential = (Object.keys(SKIN_CLASSES) as SkinClassCode[])
    .map((code) => ({ name: SKIN_CLASSES[code], value: percentage(result.probabilities[code] ?? 0) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);

  return {
    id,
    patientId: patient.id,
    patientName: patient.name,
    date: new Date(now).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    region: "Uploaded image",
    disease,
    confidence: percentage(result.confidence),
    status: result.triage === "GREEN" ? "Completed" : "Review Required",
    description: result.message,
    risk: result.triage === "RED" ? "High" : result.triage === "YELLOW" ? "Moderate" : "Low",
    differential,
    explanation: {
      gradcamCaption: "Open the analysis result to view Grad-CAM and LIME explanations.",
      lime: [],
    },
  };
}