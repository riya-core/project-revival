import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requestReviewForScan, syncQueue } from "@/lib/review-queue-sync";

// Actions that touch other users' rows (queue assignment, reviews, audit log) run here.
// Every handler verifies the caller through requireSupabaseAuth (and a role check where
// needed) before loading the service-role client.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function readText(value: unknown, max: number, label: string): string {
  if (typeof value !== "string") throw new Error(`Invalid ${label}`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new Error(`${label} is too long`);
  return trimmed;
}

function readObject(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null) throw new Error("Invalid request");
  return input as Record<string, unknown>;
}

async function loadAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

type AuthContext = {
  supabase: import("@supabase/supabase-js").SupabaseClient<import("@/integrations/supabase/types").Database>;
  userId: string;
};

async function hasRole(context: AuthContext, role: "patient" | "dermatologist" | "admin") {
  const { data, error } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: role });
  return !error && data === true;
}

export const syncReviewQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    await syncQueue(await loadAdmin(), Date.now());
    return { ok: true };
  });

export const requestScanReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ({ scanId: readUuid(readObject(input)["scanId"], "scan") }))
  .handler(async ({ data, context }) => {
    if (!(await hasRole(context, "patient"))) {
      return { ok: false as const, error: "Sign in as the patient who owns this report." };
    }
    const { data: own } = await context.supabase
      .from("scans")
      .select("id, user_id")
      .eq("id", data.scanId)
      .maybeSingle();
    if (!own || own.user_id !== context.userId) {
      return { ok: false as const, error: "This report is not available in your account." };
    }
    const admin = await loadAdmin();
    const result = await requestReviewForScan(admin, data.scanId, Date.now());
    if (result.ok) {
      await admin.rpc("write_log", {
        _actor: context.userId,
        _action: "Review Requested",
        _resource_type: "scan",
        _resource_id: data.scanId,
        _status: "Success",
        _metadata: {},
      });
    }
    return result;
  });

export const markScanSeen = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ({ scanId: readUuid(readObject(input)["scanId"], "scan") }))
  .handler(async ({ data, context }) => {
    if (!(await hasRole(context, "dermatologist"))) return { ok: false };
    const admin = await loadAdmin();
    const { error } = await admin.rpc("mark_scan_seen", { _actor: context.userId, _scan_id: data.scanId });
    return { ok: !error };
  });

export const submitReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const body = readObject(input);
    return {
      scanId: readUuid(body["scanId"], "scan"),
      diagnosis: readText(body["diagnosis"], 300, "Diagnosis"),
      notes: readText(body["notes"], 5000, "Notes"),
      recommendations: readText(body["recommendations"], 5000, "Recommendations"),
      final: body["final"] === true,
    };
  })
  .handler(async ({ data, context }) => {
    if (!(await hasRole(context, "dermatologist"))) return { ok: false };
    const admin = await loadAdmin();
    const { data: saved, error } = await admin.rpc("submit_review", {
      _actor: context.userId,
      _scan_id: data.scanId,
      _diagnosis: data.diagnosis,
      _notes: data.notes,
      _recommendations: data.recommendations,
      _final: data.final,
    });
    return { ok: !error && saved === true };
  });

export const logSessionEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const action = readObject(input)["action"];
    if (action !== "Login" && action !== "Logout") throw new Error("Invalid action");
    return { action };
  })
  .handler(async ({ data, context }) => {
    const admin = await loadAdmin();
    const { error } = await admin.rpc("log_event", { _actor: context.userId, _action: data.action });
    return { ok: !error };
  });

export const listClinicians = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const admin = await loadAdmin();
    const { data, error } = await admin.rpc("list_clinicians");
    if (error || !data) return [];
    return data.map((row) => ({ id: row.id, name: row.full_name, status: row.status }));
  });
