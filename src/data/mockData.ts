export type Role = "patient" | "dermatologist" | "admin";

export type PredictionStatus = "Completed" | "Review Required" | "Reviewed" | "Pending Review";

export interface MockUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: "Active" | "Inactive";
  createdAt: string;
  age?: number;
  gender?: string;
  phone?: string;
}

export interface Explanation {
  gradcamCaption: string;
  lime: { feature: string; value: number }[];
  /** Signed link to the saved Grad-CAM overlay for this scan, when one was generated. */
  gradcamUrl?: string;
  /** Signed link to the saved LIME overlay for this scan, when one was generated. */
  limeUrl?: string;
}

export interface PredictionReview {
  diagnosis: string;
  notes: string;
  recommendations: string;
  reviewedBy: string;
  reviewedById?: string;
  reviewedAt?: number;
}

export interface Prediction {
  id: string;
  patientId: string;
  patientName: string;
  date: string;
  region: string;
  disease: string;
  confidence: number;
  status: PredictionStatus;
  review?: PredictionReview;
  reviewHistory?: PredictionReview[];
  reviewDraft?: Omit<PredictionReview, "reviewedById" | "reviewedAt">;
  reviewRequestCount?: number;
  reviewRequestedAt?: number;
  assignedDoctorId?: string;
  assignedAt?: number;
  seenByDoctorAt?: number;
  assignmentAttempts?: number;
  queuePriority?: "Urgent" | "Standard" | "Routine";
  description: string;
  risk: "Low" | "Moderate" | "High";
  differential: { name: string; value: number }[];
  explanation: Explanation;
}

export interface SystemLog {
  id: string;
  timestamp: string;
  user: string;
  action: string;
  role: Role;
  status: "Success" | "Failed";
}

export const DEMO_ACCOUNTS: Record<Role, string> = {
  patient: "patient@demo.com",
  dermatologist: "doctor@demo.com",
  admin: "admin@demo.com",
};

const unknownDiseaseDescription =
  "The model could not confidently match this image to a known pattern in its training data.";

export const diseaseInfo: Record<string, string> = {
  Melanoma:
    "A serious form of skin cancer that develops in pigment-producing cells. Early specialist assessment is strongly advised.",
  Nevus:
    "A common benign mole formed by clusters of pigment cells. Usually harmless but worth monitoring for change.",
  "Seborrheic keratosis":
    "A benign, wart-like growth that becomes more common with age. Generally requires no treatment.",
  Eczema:
    "A chronic inflammatory condition causing itchy, dry and irritated patches of skin.",
  Psoriasis:
    "An immune-mediated condition producing thickened, scaly plaques, often on elbows, knees and scalp.",
  Unknown: unknownDiseaseDescription,
};
