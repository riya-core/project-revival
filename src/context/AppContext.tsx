import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  mockLogs,
  mockPredictions,
  mockUsers,
  type MockUser,
  type Prediction,
  type Role,
  type SystemLog,
} from "@/data/mockData";
import {
  assignReviewCase,
  canRequestReview,
  prepareExistingQueue,
  reassignOverdueReviews,
} from "@/lib/review-queue";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  age?: number;
  gender?: string;
  phone?: string;
  createdAt: string;
}

interface AppContextValue {
  hydrated: boolean;
  user: SessionUser | null;
  users: MockUser[];
  predictions: Prediction[];
  logs: SystemLog[];
  threshold: number;
  setThreshold: (value: number) => void;
  login: (email: string, role: Role) => SessionUser;
  register: (name: string, email: string, role: Role) => SessionUser;
  logout: () => void;
  updateProfile: (patch: Partial<SessionUser>) => void;
  addPrediction: (prediction: Prediction) => void;
  requestReview: (id: string) => { ok: boolean; error?: string };
  markCaseSeen: (id: string) => void;
  saveDiagnosis: (
    id: string,
    review: { diagnosis: string; notes: string; recommendations: string },
    markReviewed: boolean,
  ) => boolean;
  toggleUserStatus: (id: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

const STORAGE_KEY = "dermaai.session";

export function AppProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [users, setUsers] = useState<MockUser[]>(mockUsers);
  const [predictions, setPredictions] = useState<Prediction[]>(mockPredictions);
  const [logs, setLogs] = useState<SystemLog[]>(mockLogs);
  const [threshold, setThreshold] = useState(70);

  useEffect(() => {
    const now = Date.now();
    let restoredUsers = mockUsers;
    let restoredPredictions = mockPredictions;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setUser(JSON.parse(raw) as SessionUser);
    } catch {
      /* ignore malformed session */
    }
    try {
      const savedUsers = localStorage.getItem("dermaai.users");
      const savedPredictions = localStorage.getItem("dermaai.predictions");
      if (savedUsers) {
        const parsed = JSON.parse(savedUsers) as unknown;
        if (Array.isArray(parsed)) restoredUsers = parsed as MockUser[];
      }
      if (savedPredictions) {
        const parsed = JSON.parse(savedPredictions) as unknown;
        if (Array.isArray(parsed)) restoredPredictions = parsed as Prediction[];
      }
    } catch {
      /* ignore malformed demo data */
    }
    const queued = prepareExistingQueue(restoredPredictions, restoredUsers, now);
    setUsers(restoredUsers);
    setPredictions(reassignOverdueReviews(queued, restoredUsers, now));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem("dermaai.users", JSON.stringify(users));
    localStorage.setItem("dermaai.predictions", JSON.stringify(predictions));
  }, [hydrated, predictions, users]);

  useEffect(() => {
    if (!hydrated) return;
    const reconcileQueue = () => {
      setPredictions((current) => reassignOverdueReviews(current, users, Date.now()));
    };
    window.addEventListener("focus", reconcileQueue);
    const interval = window.setInterval(reconcileQueue, 60_000);
    return () => {
      window.removeEventListener("focus", reconcileQueue);
      window.clearInterval(interval);
    };
  }, [hydrated, users]);

  const persist = useCallback((next: SessionUser | null) => {
    setUser(next);
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else localStorage.removeItem(STORAGE_KEY);
  }, []);

  const pushLog = useCallback((entry: Omit<SystemLog, "id" | "timestamp">) => {
    setLogs((prev) => [
      {
        ...entry,
        id: `l${Date.now()}`,
        timestamp: new Date().toLocaleString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
      },
      ...prev,
    ]);
  }, []);

  const login = useCallback(
    (email: string, role: Role) => {
      const known = users.find((u) => u.email === email.toLowerCase().trim());
      const session: SessionUser = known
        ? { ...known }
        : {
            id: `u${Date.now()}`,
            name: email.split("@")[0] || "New user",
            email,
            role,
            createdAt: new Date().toLocaleDateString("en-GB", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            }),
          };
      session.role = role;
      persist(session);
      pushLog({ user: session.name, action: "Login", role, status: "Success" });
      return session;
    },
    [persist, pushLog, users],
  );

  const register = useCallback(
    (name: string, email: string, role: Role) => {
      const createdAt = new Date().toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
      const session: SessionUser = { id: `u${Date.now()}`, name, email, role, createdAt };
      setUsers((prev) => [
        { id: session.id, name, email, role, status: "Active", createdAt },
        ...prev,
      ]);
      persist(session);
      pushLog({ user: name, action: "Account Created", role, status: "Success" });
      return session;
    },
    [persist, pushLog],
  );

  const logout = useCallback(() => {
    if (user) pushLog({ user: user.name, action: "Logout", role: user.role, status: "Success" });
    persist(null);
  }, [persist, pushLog, user]);

  const updateProfile = useCallback(
    (patch: Partial<SessionUser>) => {
      setUser((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ...patch };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
      setUsers((prev) =>
        prev.map((u) => (u.id === user?.id ? { ...u, ...patch } : u)),
      );
    },
    [user?.id],
  );

  const addPrediction = useCallback(
    (prediction: Prediction) => {
      const prepared = prediction.status === "Review Required"
        ? assignReviewCase(
            {
              ...prediction,
              reviewRequestCount: prediction.reviewRequestCount ?? 0,
              reviewRequestedAt: prediction.reviewRequestedAt ?? Date.now(),
            },
            users,
            predictions,
            Date.now(),
          ) ?? prediction
        : prediction;
      setPredictions((prev) => [prepared, ...prev]);
      pushLog({
        user: prediction.patientName,
        action: "Image Analysis",
        role: "patient",
        status: "Success",
      });
    },
    [predictions, pushLog, users],
  );

  const requestReview = useCallback(
    (id: string) => {
      if (!user || user.role !== "patient") return { ok: false, error: "Sign in as the patient who owns this report." };
      const now = Date.now();
      const currentQueue = reassignOverdueReviews(predictions, users, now);
      const prediction = currentQueue.find((item) => item.id === id);
      if (!prediction || prediction.patientId !== user.id) {
        return { ok: false, error: "This report is not available in your account." };
      }
      if (!canRequestReview(prediction)) {
        return {
          ok: false,
          error: prediction.reviewRequestCount && prediction.reviewRequestCount >= 3
            ? "This report has reached its limit of 3 review requests."
            : "This report is already waiting in a dermatologist’s queue.",
        };
      }
      const {
        assignedDoctorId: _assignedDoctorId,
        assignedAt: _assignedAt,
        seenByDoctorAt: _seenByDoctorAt,
        ...predictionWithoutAssignment
      } = prediction;
      const request: Prediction = {
        ...predictionWithoutAssignment,
        status: "Pending Review" as const,
        reviewRequestCount: (prediction.reviewRequestCount ?? 0) + 1,
        reviewRequestedAt: now,
      };
      const assigned = assignReviewCase<Prediction, MockUser>(request, users, currentQueue, now);
      if (!assigned) {
        return { ok: false, error: "No active dermatologist is available to receive this report." };
      }
      setPredictions(currentQueue.map((item) => item.id === id ? assigned : item));
      pushLog({
        user: user.name,
        action: "Review Requested",
        role: "patient",
        status: "Success",
      });
      return { ok: true };
    },
    [predictions, pushLog, user, users],
  );

  const markCaseSeen = useCallback((id: string) => {
    if (!user || user.role !== "dermatologist") return;
    setPredictions((current) => {
      const queued = reassignOverdueReviews(current, users, Date.now());
      const prediction = queued.find((item) => item.id === id);
      if (!prediction || prediction.assignedDoctorId !== user.id || prediction.seenByDoctorAt) return queued;
      return queued.map((item) => item.id === id ? { ...item, seenByDoctorAt: Date.now() } : item);
    });
  }, [user, users]);

  const saveDiagnosis = useCallback<AppContextValue["saveDiagnosis"]>(
    (id, review, markReviewed) => {
      if (!user || user.role !== "dermatologist") return false;
      const existing = predictions.find((prediction) => prediction.id === id);
      if (
        !existing ||
        existing.assignedDoctorId !== user.id ||
        (existing.status !== "Pending Review" && existing.status !== "Review Required")
      ) return false;
      const now = Date.now();
      const savedReview = {
        ...review,
        reviewedBy: user.name,
        reviewedById: user.id,
        reviewedAt: now,
      };
      setPredictions((prev) =>
        prev.map((p) =>
            p.id === id
              ? markReviewed
                ? (() => {
                    const { reviewDraft: _reviewDraft, ...withoutDraft } = p;
                    return {
                      ...withoutDraft,
                      status: "Reviewed" as const,
                      review: savedReview,
                      reviewHistory: [
                        ...(p.reviewHistory ?? (p.review ? [p.review] : [])),
                        savedReview,
                      ],
                    };
                  })()
                : { ...p, reviewDraft: { ...review, reviewedBy: user.name } }
              : p,
        ),
      );
      pushLog({
        user: user.name,
        action: markReviewed ? "Report Reviewed" : "Diagnosis Updated",
        role: "dermatologist",
        status: "Success",
      });
      return true;
    },
    [predictions, pushLog, user],
  );

  const toggleUserStatus = useCallback(
    (id: string) => {
      setUsers((prev) =>
        prev.map((u) =>
          u.id === id ? { ...u, status: u.status === "Active" ? "Inactive" : "Active" } : u,
        ),
      );
      pushLog({
        user: user?.name ?? "System Admin",
        action: "User Status Changed",
        role: "admin",
        status: "Success",
      });
    },
    [pushLog, user?.name],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      hydrated,
      user,
      users,
      predictions,
      logs,
      threshold,
      setThreshold,
      login,
      register,
      logout,
      updateProfile,
      addPrediction,
      requestReview,
      markCaseSeen,
      saveDiagnosis,
      toggleUserStatus,
    }),
    [
      hydrated,
      user,
      users,
      predictions,
      logs,
      threshold,
      login,
      register,
      logout,
      updateProfile,
      addPrediction,
      requestReview,
      markCaseSeen,
      saveDiagnosis,
      toggleUserStatus,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

export const dashboardPath: Record<Role, string> = {
  patient: "/patient/dashboard",
  dermatologist: "/dermatologist/dashboard",
  admin: "/admin/dashboard",
};
