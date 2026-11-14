import type { Database, Json } from "@/integrations/supabase/types";
import type {
  Explanation,
  MockUser,
  Prediction,
  PredictionReview,
  PredictionStatus,
  Role,
  SystemLog,
} from "@/data/mockData";

type Tables = Database["public"]["Tables"];
export type ScanRow = Tables["scans"]["Row"];
export type ReportRow = Tables["reports"]["Row"];
export type ProfileRow = Tables["profiles"]["Row"];
export type PatientRow = Tables["patients"]["Row"];
export type LogRow = Tables["system_logs"]["Row"];
export type SettingRow = Tables["system_settings"]["Row"];

export type ScanWithRelations = ScanRow & {
  patients: Pick<PatientRow, "user_id" | "name"> | null;
  reports: ReportRow[] | null;
};

export interface AppSettings {
  threshold: number;
  activeModel: string;
  defaultExplanation: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  threshold: 70,
  activeModel: "DermaNet-v2 (simulated)",
  defaultExplanation: "Grad-CAM",
};

export const SETTING_KEYS = {
  threshold: "confidence_threshold",
  activeModel: "active_model",
  defaultExplanation: "default_explanation",
} as const satisfies Record<keyof AppSettings, string>;

const STATUSES: PredictionStatus[] = ["Completed", "Review Required", "Reviewed", "Pending Review"];
const ROLES: Role[] = ["patient", "dermatologist", "admin"];

export function toJson(value: unknown): Json {
  return value as Json;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStatus(value: string): PredictionStatus {
  return STATUSES.find((status) => status === value) ?? "Completed";
}

function asRisk(value: string): Prediction["risk"] {
  return value === "High" || value === "Moderate" ? value : "Low";
}

export function asRole(value: unknown): Role {
  return ROLES.find((role) => role === value) ?? "patient";
}

function asPriority(value: string | null): Prediction["queuePriority"] | undefined {
  return value === "Urgent" || value === "Standard" || value === "Routine" ? value : undefined;
}

function asDifferential(value: Json): Prediction["differential"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    isRecord(item) && typeof item["name"] === "string" && typeof item["value"] === "number"
      ? [{ name: item["name"], value: Math.round(item["value"] * 10) / 10 }]
      : [],
  );
}

function asExplanation(value: Json, urls: { gradcamUrl?: string | undefined; limeUrl?: string | undefined }): Explanation {
  const record = isRecord(value) ? value : {};
  const lime = Array.isArray(record["lime"])
    ? record["lime"].flatMap((item) =>
        isRecord(item) && typeof item["feature"] === "string" && typeof item["value"] === "number"
          ? [{ feature: item["feature"], value: item["value"] }]
          : [],
      )
    : [];
  return {
    gradcamCaption:
      typeof record["gradcamCaption"] === "string"
        ? record["gradcamCaption"]
        : "Regions that contributed most to the model prediction.",
    lime,
    ...(urls.gradcamUrl ? { gradcamUrl: urls.gradcamUrl } : {}),
    ...(urls.limeUrl ? { limeUrl: urls.limeUrl } : {}),
  };
}

function toReview(report: ReportRow): PredictionReview {
  return {
    diagnosis: report.summary,
    notes: report.notes,
    recommendations: report.recommendations,
    reviewedBy: report.reviewer_name,
    reviewedById: report.user_id,
    reviewedAt: Date.parse(report.created_at),
  };
}

/**
 * Converts a scan row (with its patient and reports) into the shape the screens use.
 * Final reports become the review history (latest = current review); a draft is only
 * surfaced to the dermatologist who wrote it.
 */
export function scanToPrediction(
  row: ScanWithRelations,
  options: { currentUserId?: string | undefined; gradcamUrl?: string | undefined; limeUrl?: string | undefined } = {},
): Prediction {
  const reports = [...(row.reports ?? [])].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const finals = reports.filter((report) => !report.is_draft).map(toReview);
  const draft = reports.find((report) => report.is_draft && report.user_id === options.currentUserId);
  const latest = finals.at(-1);
  const reviewRequestedAt = toMs(row.review_requested_at);
  const assignedAt = toMs(row.assigned_at);
  const seenByDoctorAt = toMs(row.seen_by_doctor_at);
  const queuePriority = asPriority(row.queue_priority);

  return {
    id: row.id,
    patientId: row.patients?.user_id ?? row.user_id,
    patientName: row.patients?.name || "Patient",
    date: formatDate(row.created_at),
    region: row.region,
    disease: row.prediction,
    confidence: Math.round(Number(row.confidence) * 10) / 10,
    status: asStatus(row.status),
    description: row.description,
    risk: asRisk(row.risk),
    differential: asDifferential(row.differential),
    explanation: asExplanation(row.explanation, { gradcamUrl: options.gradcamUrl, limeUrl: options.limeUrl }),
    reviewRequestCount: row.review_request_count,
    assignmentAttempts: row.assignment_attempts,
    ...(latest ? { review: latest } : {}),
    ...(finals.length ? { reviewHistory: finals } : {}),
    ...(draft
      ? {
          reviewDraft: {
            diagnosis: draft.summary,
            notes: draft.notes,
            recommendations: draft.recommendations,
            reviewedBy: draft.reviewer_name,
          },
        }
      : {}),
    ...(reviewRequestedAt !== undefined ? { reviewRequestedAt } : {}),
    ...(row.assigned_doctor_id ? { assignedDoctorId: row.assigned_doctor_id } : {}),
    ...(assignedAt !== undefined ? { assignedAt } : {}),
    ...(seenByDoctorAt !== undefined ? { seenByDoctorAt } : {}),
    ...(queuePriority ? { queuePriority } : {}),
  };
}

export function profileToUser(profile: ProfileRow, patient?: PatientRow): MockUser {
  return {
    id: profile.id,
    name: profile.full_name,
    email: profile.email,
    role: asRole(profile.role),
    status: profile.status === "Inactive" ? "Inactive" : "Active",
    createdAt: formatDate(profile.created_at),
    ...(patient?.age != null ? { age: patient.age } : {}),
    ...(patient?.sex ? { gender: patient.sex } : {}),
    ...(profile.phone ? { phone: profile.phone } : {}),
  };
}

export function logToSystemLog(row: LogRow): SystemLog {
  const metadata = isRecord(row.metadata) ? row.metadata : {};
  return {
    id: row.id,
    timestamp: formatTimestamp(row.created_at),
    user: typeof metadata["user_name"] === "string" ? metadata["user_name"] : "System",
    action: row.action,
    role: asRole(metadata["role"]),
    status: row.status === "Failed" ? "Failed" : "Success",
  };
}

export function parseSettings(rows: Pick<SettingRow, "setting_key" | "setting_value">[]): AppSettings {
  const read = (key: string) => rows.find((row) => row.setting_key === key)?.setting_value;
  const threshold = Number(read(SETTING_KEYS.threshold));
  const activeModel = read(SETTING_KEYS.activeModel);
  const defaultExplanation = read(SETTING_KEYS.defaultExplanation);
  return {
    threshold: Number.isFinite(threshold) && threshold >= 0 && threshold <= 100 ? threshold : DEFAULT_SETTINGS.threshold,
    activeModel: typeof activeModel === "string" && activeModel ? activeModel : DEFAULT_SETTINGS.activeModel,
    defaultExplanation:
      typeof defaultExplanation === "string" && defaultExplanation
        ? defaultExplanation
        : DEFAULT_SETTINGS.defaultExplanation,
  };
}
