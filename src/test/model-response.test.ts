import { describe, expect, test } from "vitest";
import {
  isUnsupportedStatus,
  modelErrorMessage,
  parseLime,
  parsePrediction,
  scanFieldsFromPrediction,
} from "@/lib/model-response";

const probabilities = { akiec: 0.01, bcc: 0.02, bkl: 0.03, df: 0.01, mel: 0.85, nv: 0.07, vasc: 0.01 };
const valid = {
  class_name: "mel",
  confidence: 0.85,
  uncertainty: 0.04,
  triage: "RED",
  message: "Possible melanoma.",
  probabilities,
  model_name: "DermaNet",
  model_version: "2.1",
};
const pixel = "data:image/png;base64,iVBORw0KGgo=";

describe("model prediction validation", () => {
  test("accepts a complete prediction and keeps model name and version", () => {
    const parsed = parsePrediction(valid);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.class_code).toBe("mel");
      expect(parsed.value.model_name).toBe("DermaNet");
      expect(parsed.value.model_version).toBe("2.1");
    }
  });

  test("rejects a prediction missing uncertainty, a class probability, or with an unknown class", () => {
    const { uncertainty: _u, ...noUncertainty } = valid;
    expect(parsePrediction(noUncertainty).ok).toBe(false);
    expect(parsePrediction({ ...valid, probabilities: { ...probabilities, vasc: undefined } }).ok).toBe(false);
    expect(parsePrediction({ ...valid, class_name: "psoriasis" }).ok).toBe(false);
    expect(parsePrediction({ ...valid, triage: "BLUE" }).ok).toBe(false);
  });

  test("RED and YELLOW results need review; GREEN is completed; confidence saved as a percentage", () => {
    const red = parsePrediction(valid);
    const green = parsePrediction({ ...valid, triage: "GREEN" });
    const yellow = parsePrediction({ ...valid, triage: "YELLOW" });
    if (!red.ok || !green.ok || !yellow.ok) throw new Error("expected valid predictions");
    expect(scanFieldsFromPrediction(red.value, "Fallback").status).toBe("Review Required");
    expect(scanFieldsFromPrediction(yellow.value, "Fallback").status).toBe("Review Required");
    expect(scanFieldsFromPrediction(green.value, "Fallback").status).toBe("Completed");
    expect(scanFieldsFromPrediction(red.value, "Fallback").confidence).toBe(85);
    expect(scanFieldsFromPrediction(red.value, "Fallback").prediction).toBe("Melanoma");
  });

  test("uses the configured model name only when the model does not report one", () => {
    const parsed = parsePrediction({ ...valid, model_name: undefined, model_version: undefined });
    if (!parsed.ok) throw new Error("expected valid prediction");
    const fields = scanFieldsFromPrediction(parsed.value, "Configured model");
    expect(fields.model_name).toBe("Configured model");
    expect(fields.model_version).toBeNull();
  });
});

describe("explanation support", () => {
  test("404, 405 and 501 mean the explanation is not supported; other errors do not", () => {
    expect(isUnsupportedStatus(404)).toBe(true);
    expect(isUnsupportedStatus(405)).toBe(true);
    expect(isUnsupportedStatus(501)).toBe(true);
    expect(isUnsupportedStatus(500)).toBe(false);
    expect(isUnsupportedStatus(503)).toBe(false);
  });

  test("LIME results must contain real image data", () => {
    const lime = { class_name: "mel", probability: 0.8, seconds: 40, num_samples: 100, original: pixel, positive_overlay: pixel, pos_neg_overlay: pixel };
    expect(parseLime(lime).ok).toBe(true);
    expect(parseLime({ ...lime, pos_neg_overlay: "https://example.com/x.png" }).ok).toBe(false);
  });

  test("a rejected token is reported as a credential problem", () => {
    expect(modelErrorMessage(401, {})).toMatch(/HF_API_TOKEN/);
  });
});
