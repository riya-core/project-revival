DROP FUNCTION IF EXISTS public.log_event(text);
DROP FUNCTION IF EXISTS public.list_clinicians();
DROP FUNCTION IF EXISTS public.mark_scan_seen(uuid);
DROP FUNCTION IF EXISTS public.submit_review(uuid, text, text, text, boolean);
DROP FUNCTION IF EXISTS public.attach_scan_explanation(uuid, text, text);

-- All functions below are called only by the app server (service role) after it has
-- verified the caller's session; _actor is the verified user id.

CREATE OR REPLACE FUNCTION public.log_event(_actor uuid, _action text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'Missing actor';
  END IF;
  IF _action NOT IN ('Login', 'Logout') THEN
    RAISE EXCEPTION 'Unsupported log action';
  END IF;
  PERFORM public.write_log(_actor, _action, 'session', _actor::text, 'Success', '{}'::jsonb);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.log_event(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_event(uuid, text) TO service_role;

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
$$;
REVOKE EXECUTE ON FUNCTION public.list_clinicians() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_clinicians() TO service_role;

CREATE OR REPLACE FUNCTION public.mark_scan_seen(_actor uuid, _scan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.scans
  SET seen_by_doctor_at = now()
  WHERE id = _scan_id
    AND assigned_doctor_id = _actor
    AND seen_by_doctor_at IS NULL
    AND status IN ('Pending Review', 'Review Required');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mark_scan_seen(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_scan_seen(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.submit_review(
  _actor uuid, _scan_id uuid, _diagnosis text, _notes text, _recommendations text, _final boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _scan public.scans%ROWTYPE;
  _name text;
BEGIN
  IF _actor IS NULL OR NOT public.has_role(_actor, 'dermatologist') THEN
    RETURN false;
  END IF;
  IF char_length(coalesce(_diagnosis, '')) > 300
     OR char_length(coalesce(_notes, '')) > 5000
     OR char_length(coalesce(_recommendations, '')) > 5000 THEN
    RAISE EXCEPTION 'Review text is too long';
  END IF;

  SELECT * INTO _scan FROM public.scans WHERE id = _scan_id FOR UPDATE;
  IF NOT FOUND
     OR _scan.assigned_doctor_id IS DISTINCT FROM _actor
     OR _scan.status NOT IN ('Pending Review', 'Review Required') THEN
    RETURN false;
  END IF;

  SELECT full_name INTO _name FROM public.profiles WHERE id = _actor;

  IF _final THEN
    DELETE FROM public.reports WHERE scan_id = _scan_id AND user_id = _actor AND is_draft;
    INSERT INTO public.reports (scan_id, user_id, summary, notes, recommendations, reviewer_name, is_draft)
    VALUES (_scan_id, _actor, coalesce(_diagnosis, ''), coalesce(_notes, ''), coalesce(_recommendations, ''), coalesce(_name, ''), false);
    UPDATE public.scans SET status = 'Reviewed' WHERE id = _scan_id;
    PERFORM public.write_log(_actor, 'Report Reviewed', 'scan', _scan_id::text, 'Success', '{}'::jsonb);
  ELSE
    INSERT INTO public.reports (scan_id, user_id, summary, notes, recommendations, reviewer_name, is_draft)
    VALUES (_scan_id, _actor, coalesce(_diagnosis, ''), coalesce(_notes, ''), coalesce(_recommendations, ''), coalesce(_name, ''), true)
    ON CONFLICT (scan_id, user_id) WHERE is_draft
    DO UPDATE SET summary = EXCLUDED.summary, notes = EXCLUDED.notes,
                  recommendations = EXCLUDED.recommendations, reviewer_name = EXCLUDED.reviewer_name;
    PERFORM public.write_log(_actor, 'Diagnosis Updated', 'scan', _scan_id::text, 'Success', '{}'::jsonb);
  END IF;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.submit_review(uuid, uuid, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_review(uuid, uuid, text, text, text, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.attach_scan_explanation(_actor uuid, _scan_id uuid, _kind text, _path text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _actor IS NULL THEN
    RETURN false;
  END IF;
  IF _kind NOT IN ('gradcam', 'lime') THEN
    RAISE EXCEPTION 'Unsupported explanation type';
  END IF;
  IF _path IS NULL OR _path NOT LIKE (_actor::text || '/' || _scan_id::text || '/%') OR char_length(_path) > 300 THEN
    RAISE EXCEPTION 'Invalid file path';
  END IF;
  IF _kind = 'gradcam' THEN
    UPDATE public.scans SET gradcam_path = _path WHERE id = _scan_id AND user_id = _actor;
  ELSE
    UPDATE public.scans SET lime_path = _path WHERE id = _scan_id AND user_id = _actor;
  END IF;
  RETURN FOUND;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.attach_scan_explanation(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_scan_explanation(uuid, uuid, text, text) TO service_role;