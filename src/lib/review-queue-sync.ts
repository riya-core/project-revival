import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  assignReviewCase,
  canRequestReview,
  MAX_REVIEW_REQUESTS,
  prepareExistingQueue,
  reassignOverdueReviews,
  type QueueCase,
  type QueueDoctor,
} from "@/lib/review-queue";

// Applies the shared review-queue rules to rows in the database. Callers pass the
// service-role client after verifying who is asking; this module never creates one.

type Client = SupabaseClient<Database>;
type ScanRow = Database["public"]["Tables"]["scans"]["Row"];
export type QueueRow = Pick<
  ScanRow,
  | "id"
  | "status"
  | "risk"
  | "review_request_count"
  | "review_requested_at"
  | "assigned_doctor_id"
  | "assigned_at"
  | "seen_by_doctor_at"
  | "assignment_attempts"
  | "queue_priority"
>;

export const OPEN_STATUSES = ["Pending Review", "Review Required"];
export const QUEUE_COLUMNS =
  "id,status,risk,review_request_count,review_requested_at,assigned_doctor_id,assigned_at,seen_by_doctor_at,assignment_attempts,queue_priority";

function toMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toIso(value: number | undefined): string | null {
  return value === undefined ? null : new Date(value).toISOString();
}

export function rowToQueueCase(row: QueueRow): QueueCase {
  const risk: QueueCase["risk"] = row.risk === "High" || row.risk === "Moderate" ? row.risk : "Low";
  const priority =
    row.queue_priority === "Urgent" || row.queue_priority === "Standard" || row.queue_priority === "Routine"
      ? row.queue_priority
      : undefined;
  const reviewRequestedAt = toMs(row.review_requested_at);
  const assignedAt = toMs(row.assigned_at);
  const seenByDoctorAt = toMs(row.seen_by_doctor_at);
  return {
    id: row.id,
    status: row.status,
    risk,
    reviewRequestCount: row.review_request_count,
    assignmentAttempts: row.assignment_attempts,
    ...(reviewRequestedAt !== undefined ? { reviewRequestedAt } : {}),
    ...(row.assigned_doctor_id ? { assignedDoctorId: row.assigned_doctor_id } : {}),
    ...(assignedAt !== undefined ? { assignedAt } : {}),
    ...(seenByDoctorAt !== undefined ? { seenByDoctorAt } : {}),
    ...(priority ? { queuePriority: priority } : {}),
  };
}

export function queueCaseToPatch(caseFile: QueueCase) {
  return {
    status: caseFile.status,
    review_request_count: caseFile.reviewRequestCount ?? 0,
    review_requested_at: toIso(caseFile.reviewRequestedAt),
    assigned_doctor_id: caseFile.assignedDoctorId ?? null,
    assigned_at: toIso(caseFile.assignedAt),
    seen_by_doctor_at: toIso(caseFile.seenByDoctorAt),
    assignment_attempts: caseFile.assignmentAttempts ?? 0,
    queue_priority: caseFile.queuePriority ?? null,
  };
}

function samePatch(a: QueueCase, b: QueueCase): boolean {
  return JSON.stringify(queueCaseToPatch(a)) === JSON.stringify(queueCaseToPatch(b));
}

async function loadQueue(client: Client): Promise<{ doctors: QueueDoctor[]; cases: QueueCase[] }> {
  const [doctorsResult, casesResult] = await Promise.all([
    client.from("profiles").select("id, role, status").eq("role", "dermatologist"),
    client.from("scans").select(QUEUE_COLUMNS).in("status", OPEN_STATUSES),
  ]);
  if (doctorsResult.error) throw new Error("Could not load dermatologists.");
  if (casesResult.error) throw new Error("Could not load the review queue.");
  return {
    doctors: doctorsResult.data.map((doctor) => ({ id: doctor.id, role: doctor.role, status: doctor.status })),
    cases: (casesResult.data as QueueRow[]).map(rowToQueueCase),
  };
}

/** Assigns unassigned open cases and moves cases unseen for four days to another dermatologist. */
export async function syncQueue(client: Client, now: number) {
  const { doctors, cases } = await loadQueue(client);
  const updated = reassignOverdueReviews(prepareExistingQueue(cases, doctors, now), doctors, now);
  const originals = new Map(cases.map((caseFile) => [caseFile.id, caseFile]));
  for (const caseFile of updated) {
    const original = originals.get(caseFile.id);
    if (!original || samePatch(original, caseFile)) continue;
    const { error } = await client
      .from("scans")
      .update(queueCaseToPatch(caseFile))
      .eq("id", caseFile.id)
      .in("status", OPEN_STATUSES);
    if (error) throw new Error("Could not update the review queue.");
  }
  return { doctors, cases: updated };
}

export type ReviewRequestResult = { ok: true } | { ok: false; error: string };

export async function requestReviewForScan(client: Client, scanId: string, now: number): Promise<ReviewRequestResult> {
  const { doctors, cases } = await syncQueue(client, now);
  const { data: row, error } = await client.from("scans").select(QUEUE_COLUMNS).eq("id", scanId).maybeSingle();
  if (error || !row) return { ok: false, error: "This report is not available in your account." };

  const current = cases.find((item) => item.id === scanId) ?? rowToQueueCase(row as QueueRow);
  if (!canRequestReview(current)) {
    return {
      ok: false,
      error:
        (current.reviewRequestCount ?? 0) >= MAX_REVIEW_REQUESTS
          ? "This report has reached its limit of 3 review requests."
          : "This report is already waiting in a dermatologist’s queue.",
    };
  }

  const {
    assignedDoctorId: _assignedDoctorId,
    assignedAt: _assignedAt,
    seenByDoctorAt: _seenByDoctorAt,
    ...withoutAssignment
  } = current;
  const request: QueueCase = {
    ...withoutAssignment,
    status: "Pending Review",
    reviewRequestCount: (current.reviewRequestCount ?? 0) + 1,
    reviewRequestedAt: now,
  };
  const assigned = assignReviewCase(request, doctors, cases, now);
  if (!assigned) return { ok: false, error: "No active dermatologist is available to receive this report." };

  const { error: updateError } = await client
    .from("scans")
    .update(queueCaseToPatch(assigned))
    .eq("id", scanId)
    .eq("status", current.status);
  if (updateError) return { ok: false, error: "The review request could not be saved." };
  return { ok: true };
}
