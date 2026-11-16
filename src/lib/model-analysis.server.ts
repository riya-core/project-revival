import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  isUnsupportedStatus,
  modelErrorMessage,
  parseGradcam,
  parseLime,
  parsePrediction,
  scanFieldsFromPrediction,
  type GradcamImages,
  type LimeImages,
  type ModelPrediction,
} from "@/lib/model-response";
import { syncQueue } from "@/lib/review-queue-sync";
import type { SkinClassCode } from "@/lib/skin-analysis";

// Server-only: talks to the user's model service with the secret token and writes results
// with the service-role client. Callers verify the signed-in user and scan ownership first.

type Admin = SupabaseClient<Database>;

export const SCAN_BUCKET = "scan-images";
export const HEATMAP_BUCKET = "heatmaps";
const STALE_ANALYSIS_MS = 10 * 60 * 1000;

export interface ModelConfig {
  baseUrl: string;
  token: string | null;
}

export type FailureCode =
  | "not_configured"
  | "not_found"
  | "forbidden"
  | "busy"
  | "already_analyzed"
  | "not_analyzed"
  | "image_missing"
  | "unreachable"
  | "model_error"
  | "invalid_response"
  | "save_failed";

export type Failure = { ok: false; code: FailureCode; error: string };

export type ExplanationOutcome<T> =
  | { status: "available"; data: T; saved: boolean }
  | { status: "unsupported"; message: string }
  | { status: "failed"; message: string };

export function readModelConfig(baseUrl: string | undefined, token: string | undefined): ModelConfig | null {
  const trimmed = baseUrl?.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  } catch {
    return null;
  }
  return { baseUrl: trimmed, token: token?.trim() || null };
}

export const NOT_CONFIGURED: Failure = {
  ok: false,
  code: "not_configured",
  error: "The analysis model is not connected yet. Add MODEL_API_URL (and HF_API_TOKEN if needed) to the project secrets.",
};

type ModelCall =
  | { kind: "ok"; payload: unknown }
  | { kind: "unsupported" }
  | { kind: "error"; code: "unreachable" | "model_error" | "invalid_response"; error: string };

async function callModel(config: ModelConfig, path: string, form: FormData, timeoutMs: number): Promise<ModelCall> {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      method: "POST",
      body: form,
      headers: {
        Accept: "application/json",
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    console.error(`[model] ${path} request failed`, error);
    return {
      kind: "error",
      code: "unreachable",
      error: timedOut
        ? "The model service took too long to respond. Please try again."
        : "Cannot reach the model service. Check MODEL_API_URL and that the service is running.",
    };
  }
  if (isUnsupportedStatus(response.status)) return { kind: "unsupported" };
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    if (response.ok) return { kind: "error", code: "invalid_response", error: "The model returned an unreadable response." };
  }
  if (!response.ok) {
    console.error(`[model] ${path} returned ${response.status}`);
    return { kind: "error", code: "model_error", error: modelErrorMessage(response.status, payload) };
  }
  return { kind: "ok", payload };
}

export async function downloadOriginal(admin: Admin, userId: string, scanId: string, imagePath: string | null) {
  if (!imagePath || !imagePath.startsWith(`${userId}/${scanId}/`)) return null;
  const { data, error } = await admin.storage.from(SCAN_BUCKET).download(imagePath);
  if (error || !data) {
    console.error("[model] original image download failed", error);
    return null;
  }
  const name = imagePath.split("/").at(-1) || "original.jpg";
  const type = /\.png$/i.test(name) ? "image/png" : "image/jpeg";
  return { blob: new Blob([await data.arrayBuffer()], { type }), name };
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; type: string; ext: string } {
  const [header = "", base64 = ""] = dataUrl.split(",", 2);
  const type = /^data:(image\/[a-z]+);/i.exec(header)?.[1]?.toLowerCase() ?? "image/png";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const ext = type === "image/jpeg" || type === "image/jpg" ? "jpg" : type === "image/webp" ? "webp" : "png";
  return { bytes, type, ext };
}

async function storeHeatmap(admin: Admin, userId: string, scanId: string, kind: "gradcam" | "lime", dataUrl: string) {
  try {
    const { bytes, type, ext } = dataUrlToBytes(dataUrl);
    const path = `${userId}/${scanId}/${kind}.${ext}`;
    const { error } = await admin.storage.from(HEATMAP_BUCKET).upload(path, bytes, { contentType: type, upsert: true });
    if (error) throw error;
    const { data: saved, error: attachError } = await admin.rpc("attach_scan_explanation", {
      _actor: userId,
      _scan_id: scanId,
      _kind: kind,
      _path: path,
    });
    if (attachError || saved !== true) throw attachError ?? new Error("Scan not updated");
    return true;
  } catch (error) {
    console.error(`[model] saving ${kind} image failed`, error);
    return false;
  }
}

async function log(admin: Admin, userId: string, action: string, scanId: string, ok: boolean, metadata: Json = {}) {
  await admin.rpc("write_log", {
    _actor: userId,
    _action: action,
    _resource_type: "scan",
    _resource_id: scanId,
    _status: ok ? "Success" : "Failed",
    _metadata: metadata,
  });
}

export async function runExplanation(
  admin: Admin,
  config: ModelConfig,
  input: {
    userId: string;
    scanId: string;
    image: { blob: Blob; name: string };
    kind: "gradcam" | "lime";
    target: SkinClassCode;
    samples: number;
  },
): Promise<ExplanationOutcome<GradcamImages> | ExplanationOutcome<LimeImages>> {
  const label = input.kind === "gradcam" ? "Grad-CAM" : "LIME";
  const form = new FormData();
  form.append("file", input.image.blob, input.image.name);
  form.append("target", input.target);
  if (input.kind === "lime") form.append("samples", String(input.samples));
  const call = await callModel(config, `/explain/${input.kind}`, form, input.kind === "lime" ? 300_000 : 120_000);
  if (call.kind === "unsupported") {
    return { status: "unsupported", message: `This model does not provide ${label} explanations.` };
  }
  if (call.kind === "error") return { status: "failed", message: call.error };

  if (input.kind === "gradcam") {
    const parsed = parseGradcam(call.payload);
    if (!parsed.ok) return { status: "failed", message: parsed.error };
    const saved = await storeHeatmap(admin, input.userId, input.scanId, "gradcam", parsed.value.overlay);
    await log(admin, input.userId, "Grad-CAM Generated", input.scanId, true, { saved });
    return { status: "available", data: parsed.value, saved };
  }
  const parsed = parseLime(call.payload);
  if (!parsed.ok) return { status: "failed", message: parsed.error };
  const saved = await storeHeatmap(admin, input.userId, input.scanId, "lime", parsed.value.pos_neg_overlay);
  await log(admin, input.userId, "LIME Generated", input.scanId, true, { saved, samples: input.samples });
  return { status: "available", data: parsed.value, saved };
}

/** Claims the scan, sends the original image to the model, validates and saves the result. */
export async function runAnalysis(
  admin: Admin,
  config: ModelConfig,
  input: { userId: string; scanId: string; imagePath: string | null; fallbackModelName: string },
): Promise<
  | { ok: true; prediction: ModelPrediction; gradcam: ExplanationOutcome<GradcamImages> }
  | Failure
> {
  const { userId, scanId } = input;
  const staleBefore = new Date(Date.now() - STALE_ANALYSIS_MS).toISOString();
  const { data: claimed, error: claimError } = await admin
    .from("scans")
    .update({ analysis_status: "analyzing", analysis_error: null })
    .eq("id", scanId)
    .eq("user_id", userId)
    .or(`analysis_status.in.(uploaded,failed),and(analysis_status.eq.analyzing,updated_at.lt.${staleBefore})`)
    .select("id");
  if (claimError || !claimed?.length) {
    return { ok: false, code: "busy", error: "This image is already being analysed. Please wait." };
  }

  const fail = async (code: FailureCode, error: string): Promise<Failure> => {
    await admin
      .from("scans")
      .update({ analysis_status: "failed", analysis_error: error.slice(0, 500) })
      .eq("id", scanId)
      .eq("user_id", userId);
    await log(admin, userId, "Image Analysis", scanId, false, { reason: code });
    return { ok: false, code, error };
  };

  const image = await downloadOriginal(admin, userId, scanId, input.imagePath);
  if (!image) return fail("image_missing", "The uploaded image could not be found. Please upload it again.");

  const form = new FormData();
  form.append("file", image.blob, image.name);
  const call = await callModel(config, "/predict", form, 120_000);
  if (call.kind === "unsupported") {
    return fail("model_error", "The model service has no prediction endpoint (/predict). Check MODEL_API_URL.");
  }
  if (call.kind === "error") return fail(call.code, call.error);
  const parsed = parsePrediction(call.payload);
  if (!parsed.ok) return fail("invalid_response", parsed.error);

  const fields = scanFieldsFromPrediction(parsed.value, input.fallbackModelName);
  const { error: saveError } = await admin
    .from("scans")
    .update({
      ...fields,
      probabilities: fields.probabilities as unknown as Json,
      differential: fields.differential as unknown as Json,
      explanation: fields.explanation as unknown as Json,
      analysis_status: "analyzed",
      analysis_error: null,
      analyzed_at: new Date().toISOString(),
    })
    .eq("id", scanId)
    .eq("user_id", userId);
  if (saveError) {
    console.error("[model] saving prediction failed", saveError);
    return fail("save_failed", "The result could not be saved. Please try again.");
  }
  await log(admin, userId, "Image Analysis", scanId, true, {
    prediction: fields.prediction,
    status: fields.status,
    model_name: fields.model_name,
  });
  if (fields.status === "Review Required") {
    try {
      await syncQueue(admin, Date.now());
    } catch (error) {
      console.error("[model] review queue sync failed", error);
    }
  }

  const gradcam = (await runExplanation(admin, config, {
    userId,
    scanId,
    image,
    kind: "gradcam",
    target: parsed.value.class_code,
    samples: 0,
  })) as ExplanationOutcome<GradcamImages>;
  return { ok: true, prediction: parsed.value, gradcam };
}
