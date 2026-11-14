# DermaAI roadmap

## Existing patient analysis page — Python model integration
- [x] Add image validation, preview, quality warnings, model prediction, triage and class probabilities.
- [x] Add Grad-CAM/LIME requests, progress and explanatory image results.
- [x] Add screening disclaimer, route metadata, and input validation tests.
- [x] Remove SHAP and add balanced doctor queues, four-day unseen-case reassignment, priorities, and three review requests per report.

- [x] Design tokens (Quiet Clinical) in src/styles.css + fonts in __root
- [x] Mock data + Auth context (localStorage)
- [x] Shared UI: Card, Badge, Button, Input, ProgressBar, Modal, LoadingState
- [x] Dashboard layout (sidebar + header, role-aware), ProtectedRoute
- [x] Landing page (/)
- [x] Login + Register
- [x] Patient: dashboard, analyze, history, history/$id, profile
- [x] Dermatologist: dashboard, reports, reports/$id, patients, profile
- [x] Admin: dashboard, users, settings, logs, profile
- [x] Explainability components (Grad-CAM image, LIME)
- [x] Head metadata per route, build clean
