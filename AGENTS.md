<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

## Project rules

- The skin-lesion model is called only from server functions in `src/lib/ml.functions.ts` (analyze, explain-lime, explain-gradcam) with `MODEL_API_URL`/`HF_API_TOKEN` server secrets; the browser only uploads the original image and never sees the token. TanStack server functions are used instead of Supabase Edge Functions because this stack runs server logic in the app.
- A scan row is created at upload (`analysis_status = uploaded`); only the server writes prediction fields and sets `analyzed`, and screens list analysed scans only, so patients cannot forge results.
- Model responses are validated by `src/lib/model-response.ts` (shared by server and tests); 404/405/501 from an explanation endpoint means the model does not support it.
- Keep review assignment, eligibility, queue priority, and four-day reassignment rules in the shared review-queue policy module so patient and doctor screens use the same rules.
- App data lives in the user's connected Supabase project; `src/context/AppContext.tsx` is the only data layer and maps rows to the existing screen types through `src/lib/scan-records.ts`, so pages keep their props and UI unchanged.
- Cross-user writes (queue assignment, reviews, seen marks, explanation paths, session logs, clinician list) go through `src/lib/dermaai.functions.ts`, which verifies the caller with `requireSupabaseAuth` and then calls service-role-only SQL functions; signed-in users cannot execute those SQL functions directly.
- Roles are authoritative in `user_roles` (checked with `has_role`); `profiles.role` is a display mirror changed only by `assign_role` from the SQL editor, so the app can never grant admin.
- Original scan images live in the private `scan-images` bucket and Grad-CAM/LIME images in the private `heatmaps` bucket (written only by the server), both under `<user_id>/<scan_id>/`; screens use short-lived signed links because storage rules key on the first folder.
- Page access stays in `DashboardLayout` (client-side redirect by role); real protection is row-level security, so every new table needs RLS plus grants.
