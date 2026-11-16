import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SKIN_CLASSES, type SkinClassCode } from "@/lib/skin-analysis";

// "analyze" and "explain-lime": the only place the model service is called. The model
// address and token are server secrets (MODEL_API_URL, HF_API_TOKEN) read inside handlers.
// Each handler verifies the signed-in patient owns the scan before touching storage.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLASS_CODES = Object.keys(SKIN_CLASSES) as SkinClassCode[];

function readObject(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null) throw new Error("Invalid request");
  return input as Record<string, unknown>;
}

function readScanId(body: Record<string, unknown>): string {
  const value = body["scanId"];
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new Error("Invalid scan");
  return value;
}

function readTarget(body: Record<string, unknown>): SkinClassCode {
  const target = CLASS_CODES.find((code) => code === body["target"]);
  if (!target) throw new Error("Invalid class");
  return target;
}

type AuthContext = {
  supabase: import("@supabase/supabase-js").SupabaseClient<import("@/integrations/supabase/types").Database>;
  userId: string;
};

/** Returns the caller's own scan, or a failure. Row-level security plus an explicit owner check. */
async function loadOwnScan(context: AuthContext, scanId: string) {
  const { data: isPatient } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "patient" });
  if (isPatient !== true) {
    return { ok: false as const, code: "forbidden" as const, error: "Only patients can analyse their own images." };
  }
  const { data: scan } = await context.supabase
    .from("scans")
    .select("id, user_id, image_path, analysis_status")
    .eq("id", scanId)
    .eq("user_id", context.userId)
    .maybeSingle();
  if (!scan || scan.user_id !== context.userId) {
    return { ok: false as const, code: "not_found" as const, error: "This scan is not available in your account." };
  }
  return { ok: true as const, scan };
}

export const analyzeScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ({ scanId: readScanId(readObject(input)) }))
  .handler(async ({ data, context }) => {
    const owned = await loadOwnScan(context, data.scanId);
    if (!owned.ok) return owned;
    if (owned.scan.analysis_status === "analyzed") {
      return { ok: false as const, code: "already_analyzed" as const, error: "This image has already been analysed." };
    }
    const server = await import("@/lib/model-analysis.server");
    const config = server.readModelConfig(process.env["MODEL_API_URL"], process.env["HF_API_TOKEN"]);
    if (!config) return server.NOT_CONFIGURED;

    const { data: setting } = await context.supabase
      .from("system_settings")
      .select("setting_value")
      .eq("setting_key", "active_model")
      .maybeSingle();
    const fallbackModelName =
      typeof setting?.setting_value === "string" && setting.setting_value ? setting.setting_value : "Skin lesion model";

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return server.runAnalysis(supabaseAdmin, config, {
      userId: context.userId,
      scanId: data.scanId,
      imagePath: owned.scan.image_path,
      fallbackModelName,
    });
  });

async function explain(context: AuthContext, scanId: string, kind: "gradcam" | "lime", target: SkinClassCode, samples: number) {
  const owned = await loadOwnScan(context, scanId);
  if (!owned.ok) return owned;
  if (owned.scan.analysis_status !== "analyzed") {
    return { ok: false as const, code: "not_analyzed" as const, error: "Analyse the image before generating explanations." };
  }
  const server = await import("@/lib/model-analysis.server");
  const config = server.readModelConfig(process.env["MODEL_API_URL"], process.env["HF_API_TOKEN"]);
  if (!config) return server.NOT_CONFIGURED;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const image = await server.downloadOriginal(supabaseAdmin, context.userId, scanId, owned.scan.image_path);
  if (!image) {
    return { ok: false as const, code: "image_missing" as const, error: "The uploaded image could not be found." };
  }
  const outcome = await server.runExplanation(supabaseAdmin, config, {
    userId: context.userId,
    scanId,
    image,
    kind,
    target,
    samples,
  });
  return { ok: true as const, outcome };
}

export const explainScanLime = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const body = readObject(input);
    return { scanId: readScanId(body), target: readTarget(body), samples: body["samples"] === 500 ? 500 : 100 };
  })
  .handler(async ({ data, context }) => {
    const result = await explain(context, data.scanId, "lime", data.target, data.samples);
    if (!result.ok) return result;
    const { outcome } = result;
    return outcome.status === "available"
      ? { ok: true as const, status: "available" as const, saved: outcome.saved, data: outcome.data as import("@/lib/model-response").LimeImages }
      : { ok: true as const, status: outcome.status, message: outcome.message };
  });

export const explainScanGradcam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const body = readObject(input);
    return { scanId: readScanId(body), target: readTarget(body) };
  })
  .handler(async ({ data, context }) => {
    const result = await explain(context, data.scanId, "gradcam", data.target, 0);
    if (!result.ok) return result;
    const { outcome } = result;
    return outcome.status === "available"
      ? { ok: true as const, status: "available" as const, saved: outcome.saved, data: outcome.data as import("@/lib/model-response").GradcamImages }
      : { ok: true as const, status: outcome.status, message: outcome.message };
  });
