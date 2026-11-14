-- =========================================================
-- DermaAI schema
-- =========================================================

CREATE TYPE public.app_role AS ENUM ('patient', 'dermatologist', 'admin');

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------
-- profiles
-- ---------------------------------------------------------
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '' CHECK (char_length(full_name) <= 120),
  role public.app_role NOT NULL DEFAULT 'patient',
  email text NOT NULL DEFAULT '',
  phone text CHECK (phone IS NULL OR char_length(phone) <= 40),
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX profiles_role_status_idx ON public.profiles (role, status);

GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (full_name, phone, status) ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------
-- user_roles (authoritative role source)
-- ---------------------------------------------------------
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
CREATE INDEX user_roles_role_idx ON public.user_roles (role);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

CREATE POLICY "Users read their own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Admins read all roles" ON public.user_roles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- profiles policies
CREATE POLICY "Users read their own profile" ON public.profiles
  FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "Admins read all profiles" ON public.profiles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Dermatologists read patient profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (role = 'patient' AND public.has_role(auth.uid(), 'dermatologist'));
CREATE POLICY "Users update their own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "Admins update any profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------
-- patients
-- ---------------------------------------------------------
CREATE TABLE public.patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '' CHECK (char_length(name) <= 120),
  age integer CHECK (age IS NULL OR age BETWEEN 0 AND 150),
  sex text CHECK (sex IS NULL OR sex IN ('Female', 'Male', 'Other')),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 5000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.patients TO authenticated;
GRANT UPDATE (age, sex, notes) ON public.patients TO authenticated;
GRANT ALL ON public.patients TO service_role;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Patients read their own record" ON public.patients
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Clinicians and admins read patient records" ON public.patients
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'dermatologist') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Patients update their own record" ON public.patients
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Clinicians and admins update patient records" ON public.patients
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'dermatologist') OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'dermatologist') OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER patients_set_updated_at
  BEFORE UPDATE ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Only clinicians/admins may change clinical notes.
CREATE OR REPLACE FUNCTION public.guard_patient_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NEW.notes IS DISTINCT FROM OLD.notes
     AND NOT (public.has_role(auth.uid(), 'dermatologist') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Only clinicians can change clinical notes';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.guard_patient_update() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER patients_guard_update
  BEFORE UPDATE ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.guard_patient_update();

-- ---------------------------------------------------------
-- scans
-- ---------------------------------------------------------
CREATE TABLE public.scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  image_path text CHECK (image_path IS NULL OR char_length(image_path) <= 300),
  prediction text NOT NULL CHECK (char_length(prediction) BETWEEN 1 AND 120),
  confidence numeric(6,3) NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  uncertainty numeric(10,6) CHECK (uncertainty IS NULL OR uncertainty >= 0),
  gradcam_path text CHECK (gradcam_path IS NULL OR char_length(gradcam_path) <= 300),
  lime_path text CHECK (lime_path IS NULL OR char_length(lime_path) <= 300),
  model_name text CHECK (model_name IS NULL OR char_length(model_name) <= 120),
  model_version text CHECK (model_version IS NULL OR char_length(model_version) <= 60),
  status text NOT NULL DEFAULT 'Completed'
    CHECK (status IN ('Completed', 'Review Required', 'Pending Review', 'Reviewed')),
  triage text CHECK (triage IS NULL OR triage IN ('GREEN', 'YELLOW', 'RED')),
  risk text NOT NULL DEFAULT 'Low' CHECK (risk IN ('Low', 'Moderate', 'High')),
  region text NOT NULL DEFAULT 'Uploaded image' CHECK (char_length(region) <= 120),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  probabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  differential jsonb NOT NULL DEFAULT '[]'::jsonb,
  explanation jsonb NOT NULL DEFAULT '{}'::jsonb,
  review_request_count integer NOT NULL DEFAULT 0 CHECK (review_request_count BETWEEN 0 AND 3),
  review_requested_at timestamptz,
  assigned_doctor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_at timestamptz,
  seen_by_doctor_at timestamptz,
  assignment_attempts integer NOT NULL DEFAULT 0 CHECK (assignment_attempts >= 0),
  queue_priority text CHECK (queue_priority IS NULL OR queue_priority IN ('Urgent', 'Standard', 'Routine')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scans_patient_id_idx ON public.scans (patient_id);
CREATE INDEX scans_user_id_created_idx ON public.scans (user_id, created_at DESC);
CREATE INDEX scans_assigned_status_idx ON public.scans (assigned_doctor_id, status);
CREATE INDEX scans_status_idx ON public.scans (status);
CREATE INDEX scans_created_at_idx ON public.scans (created_at DESC);

GRANT SELECT ON public.scans TO authenticated;
GRANT INSERT (id, patient_id, user_id, image_path, prediction, confidence, uncertainty,
  model_name, model_version, status, triage, risk, region, description,
  probabilities, differential, explanation) ON public.scans TO authenticated;
GRANT ALL ON public.scans TO service_role;
ALTER TABLE public.scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Patients read their own scans" ON public.scans
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Clinicians and admins read all scans" ON public.scans
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'dermatologist') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Patients add scans to their own record" ON public.scans
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.has_role(auth.uid(), 'patient')
    AND status IN ('Completed', 'Review Required')
    AND EXISTS (SELECT 1 FROM public.patients p WHERE p.id = patient_id AND p.user_id = auth.uid())
  );

CREATE TRIGGER scans_set_updated_at
  BEFORE UPDATE ON public.scans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------
-- reports (dermatologist reviews; drafts are private to their author)
-- ---------------------------------------------------------
CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES public.scans(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  summary text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 300),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 5000),
  recommendations text NOT NULL DEFAULT '' CHECK (char_length(recommendations) <= 5000),
  reviewer_name text NOT NULL DEFAULT '' CHECK (char_length(reviewer_name) <= 120),
  is_draft boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_scan_id_idx ON public.reports (scan_id, created_at);
CREATE INDEX reports_user_id_idx ON public.reports (user_id);
CREATE UNIQUE INDEX reports_one_draft_per_author ON public.reports (scan_id, user_id) WHERE is_draft;

GRANT SELECT ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Patients read final reports on their scans" ON public.reports
  FOR SELECT TO authenticated
  USING (
    NOT is_draft
    AND EXISTS (SELECT 1 FROM public.scans s WHERE s.id = scan_id AND s.user_id = auth.uid())
  );
CREATE POLICY "Dermatologists read final reports and own drafts" ON public.reports
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'dermatologist') AND (NOT is_draft OR user_id = auth.uid()));
CREATE POLICY "Admins read all reports" ON public.reports
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER reports_set_updated_at
  BEFORE UPDATE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------
-- system_logs
-- ---------------------------------------------------------
CREATE TABLE public.system_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 80),
  resource_type text CHECK (resource_type IS NULL OR char_length(resource_type) <= 60),
  resource_id text CHECK (resource_id IS NULL OR char_length(resource_id) <= 120),
  status text NOT NULL DEFAULT 'Success' CHECK (status IN ('Success', 'Failed')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX system_logs_created_at_idx ON public.system_logs (created_at DESC);
CREATE INDEX system_logs_actor_idx ON public.system_logs (actor_user_id);

GRANT SELECT ON public.system_logs TO authenticated;
GRANT ALL ON public.system_logs TO service_role;
ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read system logs" ON public.system_logs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Internal log writer: records actor name and role alongside the event.
CREATE OR REPLACE FUNCTION public.write_log(
  _actor uuid, _action text, _resource_type text, _resource_id text,
  _status text DEFAULT 'Success', _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _name text;
  _role text;
BEGIN
  SELECT full_name, role::text INTO _name, _role FROM public.profiles WHERE id = _actor;
  INSERT INTO public.system_logs (actor_user_id, action, resource_type, resource_id, status, metadata)
  VALUES (
    CASE WHEN _name IS NULL THEN NULL ELSE _actor END,
    _action, _resource_type, _resource_id, _status,
    coalesce(_metadata, '{}'::jsonb)
      || jsonb_build_object('user_name', coalesce(_name, 'System'), 'role', coalesce(_role, 'admin'))
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.write_log(uuid, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.write_log(uuid, text, text, text, text, jsonb) TO service_role;

-- Client-callable logger for session events only.
CREATE OR REPLACE FUNCTION public.log_event(_action text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;
  IF _action NOT IN ('Login', 'Logout') THEN
    RAISE EXCEPTION 'Unsupported log action';
  END IF;
  PERFORM public.write_log(auth.uid(), _action, 'session', auth.uid()::text, 'Success', '{}'::jsonb);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.log_event(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_event(text) TO authenticated;

-- ---------------------------------------------------------
-- system_settings
-- ---------------------------------------------------------
CREATE TABLE public.system_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key text NOT NULL UNIQUE CHECK (setting_key ~ '^[a-z_]{1,64}$'),
  setting_value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

GRANT SELECT ON public.system_settings TO authenticated;
GRANT INSERT (setting_key, setting_value), UPDATE (setting_value) ON public.system_settings TO authenticated;
GRANT ALL ON public.system_settings TO service_role;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users read settings" ON public.system_settings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins add settings" ON public.system_settings
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins change settings" ON public.system_settings
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.stamp_setting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  NEW.updated_by = coalesce(auth.uid(), NEW.updated_by);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.stamp_setting() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER system_settings_stamp
  BEFORE INSERT OR UPDATE ON public.system_settings
  FOR EACH ROW EXECUTE FUNCTION public.stamp_setting();

CREATE OR REPLACE FUNCTION public.log_setting_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.setting_value IS DISTINCT FROM OLD.setting_value THEN
    PERFORM public.write_log(auth.uid(), 'Settings Updated', 'system_setting', NEW.setting_key,
      'Success', jsonb_build_object('value', NEW.setting_value));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.log_setting_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER system_settings_log
  AFTER INSERT OR UPDATE ON public.system_settings
  FOR EACH ROW EXECUTE FUNCTION public.log_setting_change();

INSERT INTO public.system_settings (setting_key, setting_value) VALUES
  ('confidence_threshold', '70'::jsonb),
  ('active_model', '"DermaNet-v2 (simulated)"'::jsonb),
  ('default_explanation', '"Grad-CAM"'::jsonb)
ON CONFLICT (setting_key) DO NOTHING;

-- ---------------------------------------------------------
-- Profile guards & audit
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_profile_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.role IS DISTINCT FROM OLD.role OR NEW.email IS DISTINCT FROM OLD.email THEN
      RAISE EXCEPTION 'Role and email cannot be changed here';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT public.has_role(auth.uid(), 'admin') THEN
      RAISE EXCEPTION 'Only administrators can change account status';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.guard_profile_update() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER profiles_guard_update
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_update();

CREATE OR REPLACE FUNCTION public.after_profile_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.full_name IS DISTINCT FROM OLD.full_name THEN
    UPDATE public.patients SET name = NEW.full_name WHERE user_id = NEW.id;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.write_log(auth.uid(), 'User Status Changed', 'profile', NEW.id::text, 'Success',
      jsonb_build_object('target_name', NEW.full_name, 'new_status', NEW.status));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.after_profile_update() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER profiles_after_update
  AFTER UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.after_profile_update();

-- Scan audit
CREATE OR REPLACE FUNCTION public.log_scan_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.write_log(NEW.user_id, 'Image Analysis', 'scan', NEW.id::text, 'Success',
    jsonb_build_object('prediction', NEW.prediction, 'status', NEW.status));
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.log_scan_insert() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER scans_log_insert
  AFTER INSERT ON public.scans
  FOR EACH ROW EXECUTE FUNCTION public.log_scan_insert();

-- ---------------------------------------------------------
-- Sign-up: profile, role and patient record
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _role public.app_role;
  _name text;
BEGIN
  -- Self-registration may only choose patient or dermatologist; admin is never granted here.
  _role := CASE WHEN NEW.raw_user_meta_data ->> 'role' = 'dermatologist'
                THEN 'dermatologist'::public.app_role
                ELSE 'patient'::public.app_role END;
  _name := left(coalesce(nullif(trim(NEW.raw_user_meta_data ->> 'full_name'), ''),
                         split_part(coalesce(NEW.email, ''), '@', 1)), 120);

  INSERT INTO public.profiles (id, full_name, role, email)
  VALUES (NEW.id, _name, _role, coalesce(NEW.email, ''))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, _role)
  ON CONFLICT (user_id, role) DO NOTHING;

  IF _role = 'patient' THEN
    INSERT INTO public.patients (user_id, name) VALUES (NEW.id, _name)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  PERFORM public.write_log(NEW.id, 'Account Created', 'profile', NEW.id::text, 'Success', '{}'::jsonb);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill any accounts that existed before this migration.
INSERT INTO public.profiles (id, full_name, role, email)
SELECT u.id,
       left(coalesce(nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(u.email, ''), '@', 1)), 120),
       'patient', coalesce(u.email, '')
FROM auth.users u
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role)
SELECT p.id, p.role FROM public.profiles p
ON CONFLICT (user_id, role) DO NOTHING;
INSERT INTO public.patients (user_id, name)
SELECT p.id, p.full_name FROM public.profiles p WHERE p.role = 'patient'
ON CONFLICT (user_id) DO NOTHING;

-- ---------------------------------------------------------
-- Role management (run from the SQL editor only)
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_role(_email text, _role public.app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid;
BEGIN
  SELECT id INTO _uid FROM public.profiles WHERE lower(email) = lower(trim(_email));
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'No account found for %', _email;
  END IF;
  DELETE FROM public.user_roles WHERE user_id = _uid AND role <> _role;
  INSERT INTO public.user_roles (user_id, role) VALUES (_uid, _role)
  ON CONFLICT (user_id, role) DO NOTHING;
  UPDATE public.profiles SET role = _role WHERE id = _uid;
  IF _role = 'patient' THEN
    INSERT INTO public.patients (user_id, name)
    SELECT id, full_name FROM public.profiles WHERE id = _uid
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.assign_role(text, public.app_role) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_role(text, public.app_role) TO service_role;

-- ---------------------------------------------------------
-- Clinician directory (names and status only)
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_clinicians()
RETURNS TABLE (id uuid, full_name text, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.full_name, p.status
  FROM public.profiles p
  JOIN public.user_roles r ON r.user_id = p.id AND r.role = 'dermatologist'
  WHERE auth.uid() IS NOT NULL
$$;
REVOKE EXECUTE ON FUNCTION public.list_clinicians() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_clinicians() TO authenticated;

-- ---------------------------------------------------------
-- Review actions
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_scan_seen(_scan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.scans
  SET seen_by_doctor_at = now()
  WHERE id = _scan_id
    AND assigned_doctor_id = auth.uid()
    AND seen_by_doctor_at IS NULL
    AND status IN ('Pending Review', 'Review Required');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mark_scan_seen(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_scan_seen(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_review(
  _scan_id uuid, _diagnosis text, _notes text, _recommendations text, _final boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _scan public.scans%ROWTYPE;
  _name text;
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'dermatologist') THEN
    RETURN false;
  END IF;
  IF char_length(coalesce(_diagnosis, '')) > 300
     OR char_length(coalesce(_notes, '')) > 5000
     OR char_length(coalesce(_recommendations, '')) > 5000 THEN
    RAISE EXCEPTION 'Review text is too long';
  END IF;

  SELECT * INTO _scan FROM public.scans WHERE id = _scan_id FOR UPDATE;
  IF NOT FOUND
     OR _scan.assigned_doctor_id IS DISTINCT FROM _uid
     OR _scan.status NOT IN ('Pending Review', 'Review Required') THEN
    RETURN false;
  END IF;

  SELECT full_name INTO _name FROM public.profiles WHERE id = _uid;

  IF _final THEN
    DELETE FROM public.reports WHERE scan_id = _scan_id AND user_id = _uid AND is_draft;
    INSERT INTO public.reports (scan_id, user_id, summary, notes, recommendations, reviewer_name, is_draft)
    VALUES (_scan_id, _uid, coalesce(_diagnosis, ''), coalesce(_notes, ''), coalesce(_recommendations, ''), coalesce(_name, ''), false);
    UPDATE public.scans SET status = 'Reviewed' WHERE id = _scan_id;
    PERFORM public.write_log(_uid, 'Report Reviewed', 'scan', _scan_id::text, 'Success', '{}'::jsonb);
  ELSE
    INSERT INTO public.reports (scan_id, user_id, summary, notes, recommendations, reviewer_name, is_draft)
    VALUES (_scan_id, _uid, coalesce(_diagnosis, ''), coalesce(_notes, ''), coalesce(_recommendations, ''), coalesce(_name, ''), true)
    ON CONFLICT (scan_id, user_id) WHERE is_draft
    DO UPDATE SET summary = EXCLUDED.summary, notes = EXCLUDED.notes,
                  recommendations = EXCLUDED.recommendations, reviewer_name = EXCLUDED.reviewer_name;
    PERFORM public.write_log(_uid, 'Diagnosis Updated', 'scan', _scan_id::text, 'Success', '{}'::jsonb);
  END IF;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.submit_review(uuid, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_review(uuid, text, text, text, boolean) TO authenticated;

-- Patients attach saved Grad-CAM / LIME images to their own scans.
CREATE OR REPLACE FUNCTION public.attach_scan_explanation(_scan_id uuid, _kind text, _path text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;
  IF _kind NOT IN ('gradcam', 'lime') THEN
    RAISE EXCEPTION 'Unsupported explanation type';
  END IF;
  IF _path IS NULL OR _path NOT LIKE (_uid::text || '/' || _scan_id::text || '/%') OR char_length(_path) > 300 THEN
    RAISE EXCEPTION 'Invalid file path';
  END IF;
  IF _kind = 'gradcam' THEN
    UPDATE public.scans SET gradcam_path = _path WHERE id = _scan_id AND user_id = _uid;
  ELSE
    UPDATE public.scans SET lime_path = _path WHERE id = _scan_id AND user_id = _uid;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.attach_scan_explanation(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attach_scan_explanation(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------
-- Storage policies for the private "scan-images" bucket
-- Files live under <user_id>/<scan_id>/...
-- ---------------------------------------------------------
CREATE POLICY "Patients upload scan images to their folder" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'scan-images' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Patients replace their scan images" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'scan-images' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'scan-images' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Owners, clinicians and admins view scan images" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'scan-images'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.has_role(auth.uid(), 'dermatologist')
      OR public.has_role(auth.uid(), 'admin')
    )
  );