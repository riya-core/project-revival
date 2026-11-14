# Add the standalone skin-lesion analysis page

## User-facing changes
- Add a new `/analyse` page for the Python model service, without replacing or redesigning existing pages or the current patient analysis flow.
- Integrate all requested features into the existing analysis page only; do not add a new page or a home-page link.
- Build upload checks and preview, client-side image quality warnings, prediction and triage results, seven-class probability bars, and optional Grad-CAM/LIME explanations.
- Show loading, service connection, validation, and stale-response-safe states, plus the requested screening disclaimer and `data-testid` hooks.

## Technical details
- Use the provided `VITE_API_URL` value with `http://localhost:8000` as the fallback; send the selected image as multipart form data to the specified endpoints.
- Keep all work frontend-only: no new libraries, backend, authentication, or changes to existing behavior. Validate file type and 10 MB limit before requests; decode and assess image dimensions/sharpness in the browser.
- Add route-specific metadata for `/analyse`. Check the page flow and its validation states; the live model calls depend on the user's Python server being available.
