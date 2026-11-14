import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, ProgressBar } from "@/components/common/ui";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DermaAI — AI Skin Disease Detection & Prediction" },
      {
        name: "description",
        content:
          "Upload a skin photo, get a ranked AI prediction with confidence scoring, explainable visualisations and dermatologist review.",
      },
      { property: "og:title", content: "DermaAI — AI Skin Disease Detection & Prediction" },
      {
        property: "og:description",
        content:
          "Upload a skin photo, get a ranked AI prediction with confidence scoring, explainable visualisations and dermatologist review.",
      },
    ],
  }),
  component: Landing,
});

const features = [
  {
    title: "AI skin analysis",
    body: "Upload a photo and receive a ranked differential across common dermatological conditions.",
  },
  {
    title: "Explainable predictions",
    body: "Grad-CAM and LIME views show which regions and features drove each result.",
  },
  {
    title: "Confidence-based review",
    body: "Low-confidence cases are flagged automatically and routed to a dermatologist.",
  },
  {
    title: "Patient history",
    body: "Every scan is stored with its confidence, status and clinician notes.",
  },
];

const steps = [
  "Upload image",
  "AI analyses image",
  "View prediction",
  "Get explanation",
  "Consult dermatologist if required",
];

export function Nav() {
  return (
    <div className="border-b border-line bg-surface">
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex h-16 items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="grid size-8 place-items-center rounded-lg bg-brand font-display text-sm font-semibold text-surface">
              D
            </div>
            <span className="font-display text-lg font-semibold tracking-tight">DermaAI</span>
          </Link>
          <nav className="hidden items-center gap-8 text-sm font-medium text-inksoft md:flex">
            <Link to="/" className="text-ink">
              Home
            </Link>
            <a href="#how-it-works">How it works</a>
            <a href="#about">About</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link to="/login" className="text-sm font-medium text-inksoft hover:text-ink">
              Login
            </Link>
            <Link
              to="/register"
              className="rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-surface ring-1 ring-brand/60 hover:bg-brandink"
            >
              Register
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function Landing() {
  return (
    <div className="min-h-screen bg-canvas">
      <Nav />

      <div className="mx-auto max-w-6xl px-6">
        <div className="grid items-center gap-10 py-14 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-line bg-canvas2 px-3 py-1 text-xs font-medium text-inksoft">
              <span className="size-1.5 rounded-full bg-brand" />
              Educational prototype · dermatology decision support
            </div>
            <h1 className="mt-5 max-w-[16ch] font-display text-4xl font-semibold leading-[1.05] tracking-tight text-balance lg:text-5xl">
              Skin assessment your clinicians will actually trust.
            </h1>
            <p className="mt-5 max-w-[46ch] text-base text-inksoft text-pretty">
              DermaAI reads a skin image and returns a ranked prediction with a clear confidence
              score and full explainability — engineered to support, never replace, your
              dermatologist.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                to="/register"
                className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-surface ring-1 ring-brand/60 hover:bg-brandink"
              >
                Get started
              </Link>
              <a
                href="#how-it-works"
                className="rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink hover:bg-canvas2"
              >
                See the method
              </a>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-8 gap-y-2 text-sm text-mute">
              <span>27,000+ annotated lesions</span>
              <span>Explainable by design</span>
              <span>Role-based access</span>
            </div>
          </div>

          <div className="lg:col-span-5">
            <Card className="p-4">
              <div className="flex items-center justify-between pb-3">
                <span className="text-xs font-medium uppercase tracking-[0.14em] text-mute">
                  Live readout
                </span>
                <span className="rounded-md bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brandink">
                  High confidence
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-canvas2 p-3">
                  <div className="text-xs font-medium text-mute">Atopic dermatitis</div>
                  <div className="mt-1 font-display text-2xl font-semibold text-ink">92%</div>
                  <div className="mt-2">
                    <ProgressBar value={92} />
                  </div>
                </div>
                <div className="rounded-xl bg-canvas2 p-3">
                  <div className="text-xs font-medium text-mute">Tinea corporis</div>
                  <div className="mt-1 font-display text-2xl font-semibold text-ink">6%</div>
                  <div className="mt-2">
                    <ProgressBar value={6} tone="mute" />
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-3 rounded-xl bg-canvas2 p-3">
                <div className="grid size-12 shrink-0 place-items-center rounded-full bg-brand/10">
                  <span className="font-display text-sm font-semibold text-brandink">A</span>
                </div>
                <div>
                  <div className="text-sm font-semibold">Dermatologist review</div>
                  <div className="text-xs text-mute">Recommended before any treatment</div>
                </div>
              </div>
            </Card>
          </div>
        </div>

        <section id="about" className="py-10">
          <h2 className="font-display text-2xl font-semibold tracking-tight">What DermaAI does</h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((f) => (
              <Card key={f.title} className="p-4">
                <div className="text-sm font-semibold">{f.title}</div>
                <p className="mt-2 text-xs text-inksoft text-pretty">{f.body}</p>
              </Card>
            ))}
          </div>
        </section>

        <section id="how-it-works" className="py-10">
          <h2 className="font-display text-2xl font-semibold tracking-tight">How it works</h2>
          <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {steps.map((step, i) => (
              <Card key={step} className="p-4">
                <div className="font-display text-xs font-semibold text-brand">Step {i + 1}</div>
                <div className="mt-1.5 text-sm font-medium">{step}</div>
              </Card>
            ))}
          </ol>
        </section>

        <section className="pb-12">
          <Card className="p-5">
            <div className="text-sm font-semibold">Disclaimer</div>
            <p className="mt-2 max-w-[80ch] text-xs text-inksoft text-pretty">
              DermaAI is an educational, decision-support prototype built for a software engineering
              lab project. Predictions are simulated, and the system does not replace professional
              medical diagnosis, examination or treatment by a qualified dermatologist.
            </p>
          </Card>
        </section>
      </div>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-6 py-6 text-xs text-mute">
          <span>© 2026 DermaAI · Skin Disease Detection & Prediction System</span>
          <span>Prototype build · mock data only</span>
        </div>
      </footer>
    </div>
  );
}
