export const MAX_REVIEW_REQUESTS = 3;
export const REVIEW_REASSIGN_AFTER_MS = 4 * 24 * 60 * 60 * 1000;

export interface QueueCase {
  id: string;
  status: string;
  risk: "Low" | "Moderate" | "High";
  reviewRequestCount?: number;
  assignedDoctorId?: string;
  assignedAt?: number;
  reviewRequestedAt?: number;
  seenByDoctorAt?: number;
  assignmentAttempts?: number;
  queuePriority?: "Urgent" | "Standard" | "Routine";
}

export interface QueueDoctor {
  id: string;
  role: string;
  status: string;
}

export function canRequestReview(caseFile: QueueCase): boolean {
  return caseFile.status !== "Pending Review" && caseFile.status !== "Review Required" &&
    (caseFile.reviewRequestCount ?? 0) < MAX_REVIEW_REQUESTS;
}

function isOpenQueueCase(caseFile: QueueCase): boolean {
  return caseFile.status === "Pending Review" || caseFile.status === "Review Required";
}

export function getQueuePriority(risk: QueueCase["risk"]): NonNullable<QueueCase["queuePriority"]> {
  if (risk === "High") return "Urgent";
  if (risk === "Moderate") return "Standard";
  return "Routine";
}

export function selectLeastLoadedDoctor<T extends QueueDoctor>(
  doctors: T[],
  cases: QueueCase[],
  excludeDoctorId?: string,
  excludeCaseId?: string,
): T | null {
  const activeDoctors = doctors
    .filter((doctor) => doctor.role === "dermatologist" && doctor.status === "Active" && doctor.id !== excludeDoctorId)
    .map((doctor) => ({
      doctor,
      load: cases.filter((item) =>
        item.id !== excludeCaseId &&
        isOpenQueueCase(item) &&
        item.assignedDoctorId === doctor.id,
      ).length,
    }))
    .sort((a, b) => a.load - b.load || a.doctor.id.localeCompare(b.doctor.id));

  return activeDoctors[0]?.doctor ?? null;
}

export function assignReviewCase<T extends QueueCase, D extends QueueDoctor>(
  caseFile: T,
  doctors: D[],
  cases: QueueCase[],
  now: number,
  excludeDoctorId?: string,
): (T & QueueCase) | null {
  const doctor = selectLeastLoadedDoctor(doctors, cases, excludeDoctorId, caseFile.id);
  if (!doctor) return null;

  return {
    ...caseFile,
    assignedDoctorId: doctor.id,
    assignedAt: now,
    seenByDoctorAt: undefined,
    assignmentAttempts: (caseFile.assignmentAttempts ?? 0) + 1,
    queuePriority: getQueuePriority(caseFile.risk),
  };
}

export function prepareExistingQueue<T extends QueueCase, D extends QueueDoctor>(
  cases: T[],
  doctors: D[],
  now: number,
): T[] {
  let prepared = cases;
  for (const caseFile of cases) {
    if (!isOpenQueueCase(caseFile) || caseFile.assignedDoctorId) continue;
    const assigned = assignReviewCase(
      {
        ...caseFile,
        reviewRequestCount: caseFile.reviewRequestCount ?? 0,
        reviewRequestedAt: caseFile.reviewRequestedAt ?? now,
      },
      doctors,
      prepared,
      now,
    );
    if (assigned) prepared = prepared.map((item) => item.id === caseFile.id ? assigned : item);
  }
  return prepared;
}

export function reassignOverdueReviews<T extends QueueCase, D extends QueueDoctor>(
  cases: T[],
  doctors: D[],
  now: number,
): T[] {
  let updated = cases;
  for (const original of cases) {
    const current = updated.find((item) => item.id === original.id);
    if (
      !current ||
      !isOpenQueueCase(current) ||
      !current.assignedDoctorId ||
      current.seenByDoctorAt ||
      current.assignedAt === undefined ||
      now - current.assignedAt < REVIEW_REASSIGN_AFTER_MS
    ) continue;

    const reassigned = assignReviewCase(current, doctors, updated, now, current.assignedDoctorId);
    if (reassigned) updated = updated.map((item) => item.id === current.id ? reassigned as T : item);
  }
  return updated;
}

export function sortReviewQueue<T extends QueueCase>(cases: T[]): T[] {
  const priorityOrder = { Urgent: 0, Standard: 1, Routine: 2 };
  return [...cases].sort((a, b) =>
    priorityOrder[a.queuePriority ?? getQueuePriority(a.risk)] -
      priorityOrder[b.queuePriority ?? getQueuePriority(b.risk)] ||
    (a.reviewRequestedAt ?? a.assignedAt ?? 0) - (b.reviewRequestedAt ?? b.assignedAt ?? 0),
  );
}