import { describe, expect, it } from "vitest";
import { parseSettings, scanToPrediction, type ReportRow, type ScanWithRelations } from "@/lib/scan-records";

function report(overrides: Partial<ReportRow>): ReportRow {
  return {
    id: crypto.randomUUID(),
    scan_id: "scan-1",
    user_id: "doctor-a",
    summary: "Benign nevus",
    notes: "",
    recommendations: "",
    reviewer_name: "Dr. A",
    is_draft: false,
    created_at: "2026-11-10T10:00:00Z",
    updated_at: "2026-11-10T10:00:00Z",
    ...overrides,
  };
}

function scan(reports: ReportRow[]): ScanWithRelations {
  return {
    id: "scan-1",
    patient_id: "patient-record",
    user_id: "patient-user",
    image_path: null,
    analysis_status: "analyzed",
    analysis_error: null,
    analyzed_at: "2026-11-10T10:00:00Z",
    prediction: "Melanocytic nevus",
    confidence: 91.234,
    uncertainty: 0.02,
    gradcam_path: null,
    lime_path: null,
    model_name: "DermaNet-v2",
    model_version: null,
    status: "Pending Review",
    triage: "YELLOW",
    risk: "Moderate",
    region: "Uploaded image",
    description: "",
    probabilities: {},
    differential: [],
    explanation: {},
    review_request_count: 1,
    review_requested_at: "2026-11-09T10:00:00Z",
    assigned_doctor_id: "doctor-a",
    assigned_at: "2026-11-09T10:00:00Z",
    seen_by_doctor_at: null,
    assignment_attempts: 1,
    queue_priority: "Standard",
    created_at: "2026-11-09T09:00:00Z",
    updated_at: "2026-11-09T09:00:00Z",
    patients: { user_id: "patient-user", name: "Rahul Mehta" },
    reports,
  };
}

describe("scan records", () => {
  it("uses the most recent final report as the current review", () => {
    const prediction = scanToPrediction(
      scan([
        report({ summary: "First opinion", created_at: "2026-11-10T10:00:00Z" }),
        report({ summary: "Second opinion", created_at: "2026-11-12T10:00:00Z" }),
      ]),
    );
    expect(prediction.review?.diagnosis).toBe("Second opinion");
    expect(prediction.reviewHistory).toHaveLength(2);
  });

  it("shows a draft only to the dermatologist who wrote it", () => {
    const row = scan([report({ is_draft: true, summary: "Draft", user_id: "doctor-a" })]);
    expect(scanToPrediction(row, { currentUserId: "doctor-a" }).reviewDraft?.diagnosis).toBe("Draft");
    expect(scanToPrediction(row, { currentUserId: "doctor-b" }).reviewDraft).toBeUndefined();
    expect(scanToPrediction(row, { currentUserId: "doctor-a" }).review).toBeUndefined();
  });

  it("keeps the patient's account id so patient screens match their own scans", () => {
    expect(scanToPrediction(scan([])).patientId).toBe("patient-user");
  });

  it("falls back to a 70% threshold when the setting is missing or invalid", () => {
    expect(parseSettings([]).threshold).toBe(70);
    expect(parseSettings([{ setting_key: "confidence_threshold", setting_value: "abc" }]).threshold).toBe(70);
    expect(parseSettings([{ setting_key: "confidence_threshold", setting_value: 82 }]).threshold).toBe(82);
  });
});
