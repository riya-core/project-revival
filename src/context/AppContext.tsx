import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import type { MockUser, Prediction, Role, SystemLog } from "@/data/mockData";
import {
  attachScanExplanation,
  listClinicians,
  logSessionEvent,
  markScanSeen,
  requestScanReview,
  submitReview,
  syncReviewQueue,
} from "@/lib/dermaai.functions";
import {
  DEFAULT_SETTINGS,
  SETTING_KEYS,
  asRole,
  formatDate,
  logToSystemLog,
  parseSettings,
  profileToUser,
  scanToPrediction,
  toJson,
  type AppSettings,
  type PatientRow,
  type ProfileRow,
  type ScanWithRelations,
} from "@/lib/scan-records";

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

export type ActionResult = { ok: true } | { ok: false; error: string };
export type AuthResult = { ok: true; user: SessionUser } | { ok: false; error: string };
export type RegisterResult =
  | { ok: true; user: SessionUser; needsConfirmation: false }
  | { ok: true; needsConfirmation: true }
  | { ok: false; error: string };

export interface ScanDetails {
  file?: File | null;
  uncertainty?: number;
  triage?: string;
  probabilities?: Record<string, number>;
  modelName?: string;
  modelVersion?: string;
}

interface AppContextValue {
  hydrated: boolean;
  user: SessionUser | null;
  users: MockUser[];
  predictions: Prediction[];
  logs: SystemLog[];
  threshold: number;
  settings: AppSettings;
  setThreshold: (value: number) => Promise<ActionResult>;
  saveSettings: (patch: Partial<AppSettings>) => Promise<ActionResult>;
  login: (email: string, password: string, role: Role) => Promise<AuthResult>;
  register: (name: string, email: string, password: string, role: Exclude<Role, "admin">) => Promise<RegisterResult>;
  logout: () => Promise<void>;
  updateProfile: (patch: Partial<SessionUser>) => Promise<ActionResult>;
  addPrediction: (prediction: Prediction, details?: ScanDetails) => Promise<ActionResult>;
  attachExplanation: (scanId: string, kind: "gradcam" | "lime", imageSrc: string) => Promise<void>;
  requestReview: (id: string) => Promise<ActionResult>;
  markCaseSeen: (id: string) => void;
  saveDiagnosis: (
    id: string,
    review: { diagnosis: string; notes: string; recommendations: string },
    markReviewed: boolean,
  ) => Promise<boolean>;
  toggleUserStatus: (id: string) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

const SCAN_BUCKET = "scan-images";
const SCAN_SELECT = "*, patients(user_id, name), reports(*)";
const REFRESH_MS = 60_000;

const roleLabel: Record<Role, string> = {
  patient: "patient",
  dermatologist: "dermatologist",
  admin: "admin",
};

function toSessionUser(profile: ProfileRow, patient?: PatientRow): SessionUser {
  return {
    id: profile.id,
    name: profile.full_name,
    email: profile.email,
    role: asRole(profile.role),
    createdAt: formatDate(profile.created_at),
    ...(patient?.age != null ? { age: patient.age } : {}),
    ...(patient?.sex ? { gender: patient.sex } : {}),
    ...(profile.phone ? { phone: profile.phone } : {}),
  };
}

function authErrorMessage(message: string): string {
  if (/email not confirmed/i.test(message)) return "Confirm your email address first, then log in.";
  if (/invalid login credentials/i.test(message)) return "Email or password is incorrect.";
  if (/already registered|already exists/i.test(message)) return "An account with this email already exists.";
  if (/password/i.test(message)) return message;
  return "Something went wrong. Please try again.";
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [patientRecordId, setPatientRecordId] = useState<string | null>(null);
  const [users, setUsers] = useState<MockUser[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const loadedUserId = useRef<string | null>(null);
  const authInProgress = useRef(false);
  const seenRequested = useRef(new Set<string>());

  const syncQueueFn = useServerFn(syncReviewQueue);
  const requestReviewFn = useServerFn(requestScanReview);
  const markSeenFn = useServerFn(markScanSeen);
  const submitReviewFn = useServerFn(submitReview);
  const attachExplanationFn = useServerFn(attachScanExplanation);
  const logSessionFn = useServerFn(logSessionEvent);
  const listCliniciansFn = useServerFn(listClinicians);

  const clearWorkspace = useCallback(() => {
    loadedUserId.current = null;
    seenRequested.current.clear();
    setUser(null);
    setPatientRecordId(null);
    setUsers([]);
    setPredictions([]);
    setLogs([]);
    setSettings(DEFAULT_SETTINGS);
  }, []);

  const syncQueue = useCallback(async () => {
    try {
      await syncQueueFn();
    } catch (error) {
      console.error("Review queue sync failed", error);
    }
  }, [syncQueueFn]);

  /** Loads everything the signed-in user is allowed to see (row-level security filters it). */
  const loadWorkspace = useCallback(
    async (userId: string): Promise<SessionUser | null> => {
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      if (profileError || !profile) return null;
      const role = asRole(profile.role);

      const profilesQuery =
        role === "patient"
          ? Promise.resolve({ data: [profile] as ProfileRow[], error: null })
          : supabase.from("profiles").select("*").order("created_at", { ascending: false });
      const logsQuery =
        role === "admin"
          ? supabase.from("system_logs").select("*").order("created_at", { ascending: false }).limit(500)
          : Promise.resolve({ data: [], error: null });

      const [patientsResult, scansResult, settingsResult, profilesResult, logsResult, clinicians] = await Promise.all([
        supabase.from("patients").select("*"),
        supabase.from("scans").select(SCAN_SELECT).order("created_at", { ascending: false }),
        supabase.from("system_settings").select("setting_key, setting_value"),
        profilesQuery,
        logsQuery,
        listCliniciansFn().catch(() => [] as { id: string; name: string; status: string }[]),
      ]);

      const patients = patientsResult.data ?? [];
      const patientByUser = new Map(patients.map((patient) => [patient.user_id, patient]));
      const scans = (scansResult.data ?? []) as unknown as ScanWithRelations[];

      const explanationPaths = scans.flatMap((scan) =>
        [scan.gradcam_path, scan.lime_path].filter((path): path is string => Boolean(path)),
      );
      const signedUrls = new Map<string, string>();
      if (explanationPaths.length) {
        const { data: signed } = await supabase.storage.from(SCAN_BUCKET).createSignedUrls(explanationPaths, 60 * 60);
        for (const item of signed ?? []) {
          if (item.path && item.signedUrl) signedUrls.set(item.path, item.signedUrl);
        }
      }

      const nextUsers = (profilesResult.data ?? []).map((row) => profileToUser(row, patientByUser.get(row.id)));
      for (const clinician of clinicians) {
        if (nextUsers.some((person) => person.id === clinician.id)) continue;
        nextUsers.push({
          id: clinician.id,
          name: clinician.name,
          email: "",
          role: "dermatologist",
          status: clinician.status === "Inactive" ? "Inactive" : "Active",
          createdAt: "",
        });
      }

      const sessionUser = toSessionUser(profile, patientByUser.get(profile.id));
      loadedUserId.current = userId;
      setUser(sessionUser);
      setPatientRecordId(patientByUser.get(profile.id)?.id ?? null);
      setUsers(nextUsers);
      setPredictions(
        scans.map((scan) =>
          scanToPrediction(scan, {
            currentUserId: userId,
            gradcamUrl: scan.gradcam_path ? signedUrls.get(scan.gradcam_path) : undefined,
            limeUrl: scan.lime_path ? signedUrls.get(scan.lime_path) : undefined,
          }),
        ),
      );
      setLogs((logsResult.data ?? []).map(logToSystemLog));
      setSettings(parseSettings(settingsResult.data ?? []));
      return sessionUser;
    },
    [listCliniciansFn],
  );

  const reload = useCallback(async () => {
    const current = loadedUserId.current;
    if (current) await loadWorkspace(current);
  }, [loadWorkspace]);

  // Restore the session once and follow sign-in / sign-out from other tabs or email links.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const sessionUserId = data.session?.user.id;
        if (sessionUserId) {
          await syncQueue();
          await loadWorkspace(sessionUserId);
        }
      } catch (error) {
        console.error("Could not restore your session", error);
      } finally {
        if (active) setHydrated(true);
      }
    })();

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        clearWorkspace();
        return;
      }
      if (
        (event === "SIGNED_IN" || event === "USER_UPDATED") &&
        session &&
        !authInProgress.current &&
        (event === "USER_UPDATED" || loadedUserId.current !== session.user.id)
      ) {
        // Defer Supabase calls out of the auth callback to avoid blocking the client.
        setTimeout(() => {
          void loadWorkspace(session.user.id);
        }, 0);
      }
    });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [clearWorkspace, loadWorkspace, syncQueue]);

  // Keep the queue and dashboards fresh while the app is open.
  useEffect(() => {
    if (!hydrated || !user) return;
    const refresh = () => {
      void (async () => {
        await syncQueue();
        await reload();
      })();
    };
    window.addEventListener("focus", refresh);
    const interval = window.setInterval(refresh, REFRESH_MS);
    return () => {
      window.removeEventListener("focus", refresh);
      window.clearInterval(interval);
    };
  }, [hydrated, reload, syncQueue, user]);

  const login = useCallback<AppContextValue["login"]>(
    async (email, password, role) => {
      authInProgress.current = true;
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });
        if (error || !data.user) return { ok: false, error: authErrorMessage(error?.message ?? "") };
        await syncQueue();
        const session = await loadWorkspace(data.user.id);
        if (!session) {
          await supabase.auth.signOut();
          return { ok: false, error: "Your account profile could not be loaded." };
        }
        if (session.role !== role) {
          await supabase.auth.signOut();
          return { ok: false, error: `This account is registered as a ${roleLabel[session.role]}. Choose that role to log in.` };
        }
        try {
          await logSessionFn({ data: { action: "Login" } });
        } catch {
          /* logging must not block sign-in */
        }
        return { ok: true, user: session };
      } finally {
        authInProgress.current = false;
      }
    },
    [loadWorkspace, logSessionFn, syncQueue],
  );

  const register = useCallback<AppContextValue["register"]>(
    async (name, email, password, role) => {
      authInProgress.current = true;
      try {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: {
            data: { full_name: name, role },
            emailRedirectTo: `${window.location.origin}/login`,
          },
        });
        if (error) return { ok: false, error: authErrorMessage(error.message) };
        if (data.user && data.user.identities?.length === 0) {
          return { ok: false, error: "An account with this email already exists." };
        }
        if (!data.session || !data.user) return { ok: true, needsConfirmation: true };
        const session = await loadWorkspace(data.user.id);
        if (!session) return { ok: false, error: "Your account was created but could not be loaded. Try logging in." };
        return { ok: true, user: session, needsConfirmation: false };
      } finally {
        authInProgress.current = false;
      }
    },
    [loadWorkspace],
  );

  const logout = useCallback(async () => {
    try {
      await logSessionFn({ data: { action: "Logout" } });
    } catch {
      /* ignore */
    }
    await supabase.auth.signOut();
    clearWorkspace();
  }, [clearWorkspace, logSessionFn]);

  const updateProfile = useCallback<AppContextValue["updateProfile"]>(
    async (patch) => {
      if (!user) return { ok: false, error: "Sign in to update your profile." };
      const { error } = await supabase
        .from("profiles")
        .update({
          ...(patch.name !== undefined ? { full_name: patch.name.slice(0, 120) } : {}),
          ...(patch.phone !== undefined ? { phone: patch.phone.slice(0, 40) || null } : {}),
        })
        .eq("id", user.id);
      if (error) return { ok: false, error: "Your profile could not be saved." };
      if (user.role === "patient" && (patch.age !== undefined || patch.gender !== undefined)) {
        const { error: patientError } = await supabase
          .from("patients")
          .update({
            ...(patch.age !== undefined ? { age: patch.age } : {}),
            ...(patch.gender !== undefined ? { sex: patch.gender } : {}),
          })
          .eq("user_id", user.id);
        if (patientError) return { ok: false, error: "Your age or gender could not be saved." };
      }
      await reload();
      return { ok: true };
    },
    [reload, user],
  );

  const addPrediction = useCallback<AppContextValue["addPrediction"]>(
    async (prediction, details = {}) => {
      if (!user || user.role !== "patient" || !patientRecordId) {
        return { ok: false, error: "Sign in as a patient to save scans." };
      }
      let imagePath: string | null = null;
      if (details.file) {
        const ext = /\.png$/i.test(details.file.name) ? "png" : "jpg";
        const path = `${user.id}/${prediction.id}/original.${ext}`;
        const { error: uploadError } = await supabase.storage.from(SCAN_BUCKET).upload(path, details.file, {
          contentType: ext === "png" ? "image/png" : "image/jpeg",
          upsert: true,
        });
        if (!uploadError) imagePath = path;
        else console.error("Scan image upload failed", uploadError);
      }
      const { error } = await supabase.from("scans").insert({
        id: prediction.id,
        patient_id: patientRecordId,
        user_id: user.id,
        image_path: imagePath,
        prediction: prediction.disease.slice(0, 120),
        confidence: Math.min(100, Math.max(0, prediction.confidence)),
        uncertainty: details.uncertainty ?? null,
        model_name: details.modelName?.slice(0, 120) ?? settings.activeModel,
        model_version: details.modelVersion?.slice(0, 60) ?? null,
        status: prediction.status,
        triage: details.triage ?? null,
        risk: prediction.risk,
        region: prediction.region,
        description: prediction.description.slice(0, 2000),
        probabilities: toJson(details.probabilities ?? {}),
        differential: toJson(prediction.differential),
        explanation: toJson(prediction.explanation),
      });
      if (error) {
        console.error("Saving scan failed", error);
        return { ok: false, error: "This result could not be saved to your history." };
      }
      if (prediction.status === "Review Required") await syncQueue();
      await reload();
      return { ok: true };
    },
    [patientRecordId, reload, settings.activeModel, syncQueue, user],
  );

  const attachExplanation = useCallback<AppContextValue["attachExplanation"]>(
    async (scanId, kind, imageSrc) => {
      if (!user || user.role !== "patient" || !imageSrc.startsWith("data:image/")) return;
      try {
        const blob = await (await fetch(imageSrc)).blob();
        const ext = blob.type === "image/jpeg" ? "jpg" : "png";
        const path = `${user.id}/${scanId}/${kind}.${ext}`;
        const { error } = await supabase.storage.from(SCAN_BUCKET).upload(path, blob, {
          contentType: blob.type || "image/png",
          upsert: true,
        });
        if (error) throw error;
        await attachExplanationFn({ data: { scanId, kind, path } });
        await reload();
      } catch (error) {
        console.error("Saving explanation image failed", error);
      }
    },
    [attachExplanationFn, reload, user],
  );

  const requestReview = useCallback<AppContextValue["requestReview"]>(
    async (id) => {
      if (!user || user.role !== "patient") return { ok: false, error: "Sign in as the patient who owns this report." };
      try {
        const result = await requestReviewFn({ data: { scanId: id } });
        if (!result.ok) return { ok: false, error: result.error };
        await reload();
        return { ok: true };
      } catch {
        return { ok: false, error: "The review request could not be sent. Please try again." };
      }
    },
    [reload, requestReviewFn, user],
  );

  const markCaseSeen = useCallback(
    (id: string) => {
      if (!user || user.role !== "dermatologist" || seenRequested.current.has(id)) return;
      const prediction = predictions.find((item) => item.id === id);
      if (!prediction || prediction.assignedDoctorId !== user.id || prediction.seenByDoctorAt) return;
      seenRequested.current.add(id);
      void markSeenFn({ data: { scanId: id } })
        .then((result) => {
          if (!result.ok) return;
          const now = Date.now();
          setPredictions((current) =>
            current.map((item) => (item.id === id && !item.seenByDoctorAt ? { ...item, seenByDoctorAt: now } : item)),
          );
        })
        .catch(() => seenRequested.current.delete(id));
    },
    [markSeenFn, predictions, user],
  );

  const saveDiagnosis = useCallback<AppContextValue["saveDiagnosis"]>(
    async (id, review, markReviewed) => {
      if (!user || user.role !== "dermatologist") return false;
      try {
        const result = await submitReviewFn({ data: { scanId: id, ...review, final: markReviewed } });
        if (result.ok) await reload();
        return result.ok;
      } catch {
        return false;
      }
    },
    [reload, submitReviewFn, user],
  );

  const toggleUserStatus = useCallback(
    async (id: string) => {
      if (!user || user.role !== "admin") return;
      const target = users.find((person) => person.id === id);
      if (!target) return;
      const { error } = await supabase
        .from("profiles")
        .update({ status: target.status === "Active" ? "Inactive" : "Active" })
        .eq("id", id);
      if (error) console.error("Changing account status failed", error);
      await reload();
    },
    [reload, user, users],
  );

  const saveSettings = useCallback<AppContextValue["saveSettings"]>(
    async (patch) => {
      if (!user || user.role !== "admin") return { ok: false, error: "Only administrators can change settings." };
      const entries = (Object.keys(patch) as (keyof AppSettings)[]).flatMap((key) =>
        patch[key] === undefined ? [] : [{ key: SETTING_KEYS[key], value: patch[key] }],
      );
      for (const entry of entries) {
        const { error } = await supabase
          .from("system_settings")
          .update({ setting_value: toJson(entry.value) })
          .eq("setting_key", entry.key);
        if (error) return { ok: false, error: "Settings could not be saved." };
      }
      await reload();
      return { ok: true };
    },
    [reload, user],
  );

  const setThreshold = useCallback((value: number) => saveSettings({ threshold: value }), [saveSettings]);

  const value = useMemo<AppContextValue>(
    () => ({
      hydrated,
      user,
      users,
      predictions,
      logs,
      threshold: settings.threshold,
      settings,
      setThreshold,
      saveSettings,
      login,
      register,
      logout,
      updateProfile,
      addPrediction,
      attachExplanation,
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
      settings,
      setThreshold,
      saveSettings,
      login,
      register,
      logout,
      updateProfile,
      addPrediction,
      attachExplanation,
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
