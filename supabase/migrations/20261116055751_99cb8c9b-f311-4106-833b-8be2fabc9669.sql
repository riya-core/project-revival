ALTER TABLE public.scans ALTER COLUMN prediction DROP NOT NULL;
ALTER TABLE public.scans ALTER COLUMN confidence DROP NOT NULL;
ALTER TABLE public.scans ADD COLUMN analysis_status text NOT NULL DEFAULT 'analyzed'
  CHECK (analysis_status IN ('uploaded', 'analyzing', 'analyzed', 'failed'));
ALTER TABLE public.scans ALTER COLUMN analysis_status SET DEFAULT 'uploaded';
ALTER TABLE public.scans ADD COLUMN analysis_error text
  CHECK (analysis_error IS NULL OR char_length(analysis_error) <= 500);
ALTER TABLE public.scans ADD COLUMN analyzed_at timestamptz;
ALTER TABLE public.scans ADD CONSTRAINT scans_analyzed_has_result
  CHECK (analysis_status <> 'analyzed' OR (prediction IS NOT NULL AND confidence IS NOT NULL));
CREATE INDEX scans_user_analysis_idx ON public.scans (user_id, analysis_status);

-- Patients may only register an uploaded image; model results are written by the app server.
REVOKE INSERT ON public.scans FROM authenticated;
GRANT INSERT (id, patient_id, user_id, image_path, region) ON public.scans TO authenticated;

DROP POLICY IF EXISTS "Patients add scans to their own record" ON public.scans;
CREATE POLICY "Patients register uploaded images on their own record" ON public.scans
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.has_role(auth.uid(), 'patient')
    AND analysis_status = 'uploaded'
    AND status = 'Completed'
    AND prediction IS NULL
    AND confidence IS NULL
    AND image_path IS NOT NULL
    AND image_path LIKE (auth.uid()::text || '/' || id::text || '/%')
    AND EXISTS (SELECT 1 FROM public.patients p WHERE p.id = patient_id AND p.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Clinicians and admins read all scans" ON public.scans;
CREATE POLICY "Admins read all scans" ON public.scans
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Dermatologists read analysed scans" ON public.scans
  FOR SELECT TO authenticated
  USING (analysis_status = 'analyzed' AND public.has_role(auth.uid(), 'dermatologist'));

-- Separate upload and analysis audit entries.
CREATE OR REPLACE FUNCTION public.log_scan_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.write_log(NEW.user_id, 'Image Uploaded', 'scan', NEW.id::text, 'Success',
    jsonb_build_object('status', NEW.analysis_status));
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.log_scan_insert() FROM PUBLIC, anon, authenticated;

-- Private heatmaps bucket: <user_id>/<scan_id>/... ; written only by the service role.
CREATE POLICY "Owners, clinicians and admins view heatmaps" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'heatmaps'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.has_role(auth.uid(), 'dermatologist')
      OR public.has_role(auth.uid(), 'admin')
    )
  );