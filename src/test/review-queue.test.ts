import { describe, expect, test } from "vitest";
import {
  MAX_REVIEW_REQUESTS,
  REVIEW_REASSIGN_AFTER_MS,
  assignReviewCase,
  canRequestReview,
  reassignOverdueReviews,
  selectLeastLoadedDoctor,
} from "@/lib/review-queue";

const doctors = [
  { id: "d1", role: "dermatologist", status: "Active" },
  { id: "d2", role: "dermatologist", status: "Active" },
  { id: "inactive", role: "dermatologist", status: "Inactive" },
];
const openCase = (id: string, doctorId?: string, assignedAt = 1) => ({
  id,
  status: "Pending Review",
  risk: "Moderate" as const,
  assignedDoctorId: doctorId,
  assignedAt,
});

describe("review queue rules", () => {
  test("assigns a new case to the active doctor with the smallest queue", () => {
    const assigned = assignReviewCase(openCase("new"), doctors, [openCase("existing", "d1")], 10);
    expect(assigned?.assignedDoctorId).toBe("d2");
    expect(selectLeastLoadedDoctor(doctors, [], "d1")?.id).toBe("d2");
  });

  test("allows up to three accepted review requests per report", () => {
    expect(MAX_REVIEW_REQUESTS).toBe(3);
    expect(canRequestReview({ id: "one", status: "Reviewed", risk: "Low", reviewRequestCount: 2 })).toBe(true);
    expect(canRequestReview({ id: "one", status: "Reviewed", risk: "Low", reviewRequestCount: 3 })).toBe(false);
    expect(canRequestReview({ id: "one", status: "Pending Review", risk: "Low", reviewRequestCount: 1 })).toBe(false);
  });

  test("allows a normal completed skin prediction to be sent for review", () => {
    expect(canRequestReview({ id: "normal", status: "Completed", risk: "Low", reviewRequestCount: 0 })).toBe(true);
    expect(canRequestReview({ id: "reviewed", status: "Reviewed", risk: "Low", reviewRequestCount: 1 })).toBe(true);
  });

  test("moves an unseen case to another active doctor at exactly four days", () => {
    const initial = [openCase("overdue", "d1", 5)];
    const reassigned = reassignOverdueReviews(initial, doctors, 5 + REVIEW_REASSIGN_AFTER_MS);
    expect(reassigned[0]?.assignedDoctorId).toBe("d2");
    expect(reassigned[0]?.assignmentAttempts).toBe(1);
    expect(reassignOverdueReviews(initial, doctors, 5 + REVIEW_REASSIGN_AFTER_MS - 1)[0]?.assignedDoctorId).toBe("d1");
  });

  test("does not move a case already seen by its doctor", () => {
    const seen = [{ ...openCase("seen", "d1", 5), seenByDoctorAt: 6 }];
    expect(reassignOverdueReviews(seen, doctors, 5 + REVIEW_REASSIGN_AFTER_MS)[0]?.assignedDoctorId).toBe("d1");
  });

  test("keeps an overdue report with its current doctor when no alternative is active", () => {
    const singleDoctor = doctors.filter((doctor) => doctor.id === "d1");
    const overdue = [openCase("overdue", "d1", 5)];
    expect(reassignOverdueReviews(overdue, singleDoctor, 5 + REVIEW_REASSIGN_AFTER_MS)[0]?.assignedDoctorId).toBe("d1");
  });

  test("assigns high-risk cases urgent priority and records request count without changing it on reassignment", () => {
    const assigned = assignReviewCase({ ...openCase("high"), risk: "High", reviewRequestCount: 2 }, doctors, [], 10);
    expect(assigned?.queuePriority).toBe("Urgent");
    const moved = reassignOverdueReviews([{ ...assigned, assignedAt: 1 }], doctors, 1 + REVIEW_REASSIGN_AFTER_MS);
    expect(moved[0]?.reviewRequestCount).toBe(2);
  });
});