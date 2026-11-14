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

export const mockUsers: MockUser[] = [
  {
    id: "u1",
    name: "Rahul Mehta",
    email: "patient@demo.com",
    role: "patient",
    status: "Active",
    createdAt: "12 Jan 2026",
    age: 28,
    gender: "Male",
    phone: "+91 98200 11223",
  },
  {
    id: "u2",
    name: "Ananya Rao",
    email: "ananya@demo.com",
    role: "patient",
    status: "Active",
    createdAt: "03 Feb 2026",
    age: 34,
    gender: "Female",
    phone: "+91 98111 44556",
  },
  {
    id: "u3",
    name: "Imran Qureshi",
    email: "imran@demo.com",
    role: "patient",
    status: "Inactive",
    createdAt: "19 Mar 2026",
    age: 41,
    gender: "Male",
    phone: "+91 90000 77889",
  },
  {
    id: "u4",
    name: "Dr. Neha Sharma",
    email: "doctor@demo.com",
    role: "dermatologist",
    status: "Active",
    createdAt: "08 Nov 2025",
    phone: "+91 99887 66554",
  },
  {
    id: "u5",
    name: "Dr. Kabir Menon",
    email: "kabir@demo.com",
    role: "dermatologist",
    status: "Active",
    createdAt: "22 Dec 2025",
  },
  {
    id: "u6",
    name: "System Admin",
    email: "admin@demo.com",
    role: "admin",
    status: "Active",
    createdAt: "01 Oct 2025",
  },
];

const baseExplanation: Explanation = {
  gradcamCaption: "Regions that contributed most to the model prediction.",
  lime: [
    { feature: "Irregular border", value: 0.41 },
    { feature: "Pigment asymmetry", value: 0.28 },
    { feature: "Texture variance", value: 0.19 },
    { feature: "Uniform tone", value: -0.14 },
    { feature: "Smooth margin", value: -0.22 },
  ],
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

function diseaseDescription(disease: string): string {
  return diseaseInfo[disease] ?? unknownDiseaseDescription;
}

export const mockPredictions: Prediction[] = [
  {
    id: "p1",
    patientId: "u1",
    patientName: "Rahul Mehta",
    date: "12 Sep 2026",
    region: "Left forearm",
    disease: "Melanoma",
    confidence: 87,
    status: "Completed",
    description: diseaseDescription("Melanoma"),
    risk: "High",
    differential: [
      { name: "Melanoma", value: 87 },
      { name: "Atypical nevus", value: 8 },
      { name: "Seborrheic keratosis", value: 5 },
    ],
    explanation: baseExplanation,
  },
  {
    id: "p2",
    patientId: "u1",
    patientName: "Rahul Mehta",
    date: "08 Sep 2026",
    region: "Upper back",
    disease: "Nevus",
    confidence: 92,
    status: "Completed",
    description: diseaseDescription("Nevus"),
    risk: "Low",
    differential: [
      { name: "Nevus", value: 92 },
      { name: "Seborrheic keratosis", value: 5 },
      { name: "Melanoma", value: 3 },
    ],
    explanation: baseExplanation,
  },
  {
    id: "p3",
    patientId: "u1",
    patientName: "Rahul Mehta",
    date: "01 Sep 2026",
    region: "Right thigh",
    disease: "Unknown",
    confidence: 54,
    status: "Review Required",
    description: diseaseDescription("Unknown"),
    risk: "Moderate",
    differential: [
      { name: "Unknown", value: 54 },
      { name: "Eczema", value: 28 },
      { name: "Psoriasis", value: 18 },
    ],
    explanation: baseExplanation,
  },
  {
    id: "p4",
    patientId: "u2",
    patientName: "Ananya Rao",
    date: "11 Sep 2026",
    region: "Cheek",
    disease: "Nevus",
    confidence: 91,
    status: "Reviewed",
    description: diseaseDescription("Nevus"),
    risk: "Low",
    differential: [
      { name: "Nevus", value: 91 },
      { name: "Melasma", value: 6 },
      { name: "Melanoma", value: 3 },
    ],
    review: {
      diagnosis: "Benign melanocytic nevus",
      notes: "Stable appearance compared with previous scan.",
      recommendations: "Re-scan in 6 months. No treatment needed.",
      reviewedBy: "Dr. Neha Sharma",
    },
    explanation: baseExplanation,
  },
  {
    id: "p5",
    patientId: "u3",
    patientName: "Imran Qureshi",
    date: "10 Sep 2026",
    region: "Scalp",
    disease: "Psoriasis",
    confidence: 63,
    status: "Pending Review",
    description: diseaseDescription("Psoriasis"),
    risk: "Moderate",
    differential: [
      { name: "Psoriasis", value: 63 },
      { name: "Eczema", value: 25 },
      { name: "Tinea capitis", value: 12 },
    ],
    explanation: baseExplanation,
  },
];

export const mockLogs: SystemLog[] = [
  {
    id: "l1",
    timestamp: "12 Sep 2026 10:32",
    user: "Rahul Mehta",
    action: "Image Analysis",
    role: "patient",
    status: "Success",
  },
  {
    id: "l2",
    timestamp: "12 Sep 2026 10:35",
    user: "Dr. Neha Sharma",
    action: "Diagnosis Updated",
    role: "dermatologist",
    status: "Success",
  },
  {
    id: "l3",
    timestamp: "12 Sep 2026 11:02",
    user: "Imran Qureshi",
    action: "Login Attempt",
    role: "patient",
    status: "Failed",
  },
  {
    id: "l4",
    timestamp: "11 Sep 2026 18:20",
    user: "System Admin",
    action: "User Deactivated",
    role: "admin",
    status: "Success",
  },
  {
    id: "l5",
    timestamp: "11 Sep 2026 09:14",
    user: "Ananya Rao",
    action: "Review Requested",
    role: "patient",
    status: "Success",
  },
];

const diseasePool: (keyof typeof diseaseInfo)[] = [
  "Melanoma",
  "Nevus",
  "Seborrheic keratosis",
  "Eczema",
  "Psoriasis",
  "Unknown",
];

export function generateMockPrediction(): Omit<Prediction, "id" | "patientId" | "patientName"> {
  const disease = diseasePool[Math.floor(Math.random() * diseasePool.length)] ?? "Unknown";
  const confidence =
    disease === "Unknown"
      ? 45 + Math.floor(Math.random() * 20)
      : 55 + Math.floor(Math.random() * 42);
  const second = Math.round((100 - confidence) * 0.6);
  const third = 100 - confidence - second;
  return {
    date: new Date().toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    region: "Uploaded image",
    disease,
    confidence,
    status: confidence >= 70 ? "Completed" : "Review Required",
    description: diseaseDescription(disease),
    risk: confidence >= 85 && disease === "Melanoma" ? "High" : confidence >= 70 ? "Low" : "Moderate",
    differential: [
      { name: disease, value: confidence },
      { name: "Eczema", value: second },
      { name: "Nevus", value: third },
    ],
    explanation: baseExplanation,
  };
}
