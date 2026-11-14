import { describe, expect, test } from "vitest";
import { MAX_IMAGE_BYTES, SKIN_CLASSES, classCode, classLabel, percentage, toPatientReport, validateImageFile } from "@/lib/skin-analysis";

describe("skin analysis input rules", () => {
  test("accepts JPG and PNG up to 10 MB, including the exact limit", () => {
    expect(validateImageFile({ name: "lesion.jpg", type: "image/jpeg", size: MAX_IMAGE_BYTES })).toBeNull();
    expect(validateImageFile({ name: "lesion.png", type: "image/png", size: 100 })).toBeNull();
  });

  test("rejects files larger than 10 MB and unsupported formats", () => {
    expect(validateImageFile({ name: "large.jpg", type: "image/jpeg", size: MAX_IMAGE_BYTES + 1 })).toBe(
      "Image must be 10 MB or smaller.",
    );
    expect(validateImageFile({ name: "report.pdf", type: "application/pdf", size: 100 })).toBe(
      "Unsupported file. Please upload a JPG or PNG skin image.",
    );
    expect(validateImageFile({ name: "report.pdf", type: "image/jpeg", size: 100 })).toBe(
      "Unsupported file. Please upload a JPG or PNG skin image.",
    );
  });
});

describe("prediction labels and probability formatting", () => {
  test("maps each of the seven model class codes to its full name", () => {
    expect(Object.keys(SKIN_CLASSES)).toHaveLength(7);
    expect(classLabel("mel")).toBe("Melanoma");
    expect(classLabel("nv")).toBe("Melanocytic nevus");
    expect(classCode("Melanoma")).toBe("mel");
    expect(classCode("nv")).toBe("nv");
  });

  test("converts decimal probabilities to percentages and preserves percent values", () => {
    expect(percentage(0.725)).toBe(72.5);
    expect(percentage(72.5)).toBe(72.5);
  });

  test("turns a normal scan into a patient-owned report that can request review", () => {
    const report = toPatientReport({
      class_name: "nv",
      confidence: 0.9,
      triage: "GREEN",
      message: "Low-risk model result",
      probabilities: { nv: 0.9, mel: 0.05, bkl: 0.03, akiec: 0.01, bcc: 0.005, df: 0.003, vasc: 0.002 },
    }, { id: "patient-1", name: "Patient One" }, "scan-1", Date.UTC(2026, 0, 1));

    expect(report.patientId).toBe("patient-1");
    expect(report.status).toBe("Completed");
    expect(report.disease).toBe("Melanocytic nevus");
    expect(report.confidence).toBe(90);
  });

  test("marks a non-green model result for dermatologist review", () => {
    const report = toPatientReport({
      class_name: "mel",
      confidence: 0.71,
      triage: "RED",
      message: "Priority assessment advised",
      probabilities: { mel: 0.71, nv: 0.2, bkl: 0.09 },
    }, { id: "patient-1", name: "Patient One" }, "scan-2", Date.UTC(2026, 0, 1));

    expect(report.status).toBe("Review Required");
    expect(report.risk).toBe("High");
  });
});