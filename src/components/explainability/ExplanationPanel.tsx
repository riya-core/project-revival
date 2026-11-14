import { useState } from "react";
import gradcam from "@/assets/gradcam.jpg";
import type { Explanation } from "@/data/mockData";
import { cn } from "@/lib/utils";

const tabs = ["Grad-CAM", "LIME"] as const;
type Tab = (typeof tabs)[number];

function ContributionBars({ items }: { items: { feature: string; value: number }[] }) {
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 0.01);
  return (
    <div className="space-y-2.5">
      {items.map((item) => {
        const positive = item.value >= 0;
        return (
          <div key={item.feature}>
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-inksoft">{item.feature}</span>
              <span className={positive ? "font-medium text-riskink" : "font-medium text-brandink"}>
                {positive ? "+" : ""}
                {item.value.toFixed(2)}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
              <div
                className={cn("h-full rounded-full", positive ? "bg-risk" : "bg-brand")}
                style={{ width: `${(Math.abs(item.value) / max) * 100}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ExplanationPanel({ explanation }: { explanation: Explanation }) {
  const [tab, setTab] = useState<Tab>("Grad-CAM");

  return (
    <div>
      <div className="flex items-center gap-1 border-b border-line text-sm font-medium">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-3 py-2",
              tab === t ? "rounded-t-md text-brandink" : "text-mute hover:text-ink",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {tab === "Grad-CAM" ? (
          <img
            src={gradcam}
            alt="Grad-CAM heatmap overlay highlighting the lesion regions that influenced the prediction"
            className="aspect-[16/10] w-full rounded-lg object-cover outline-1 -outline-offset-1 outline-black/5"
            loading="lazy"
          />
        ) : (
          <div className="rounded-lg bg-canvas2 p-4">
            <div className="text-sm font-semibold">
              "Local feature contributions"
            </div>
            <div className="mt-3">
              <ContributionBars items={explanation.lime} />
            </div>
          </div>
        )}

        <div className="rounded-lg bg-canvas2 p-4 text-sm text-inksoft">
          <div className="font-semibold text-ink">Why this call</div>
          <p className="mt-2 text-xs text-pretty">
            {tab === "Grad-CAM"
              ? explanation.gradcamCaption
              : "LIME perturbs regions of the image and measures how the prediction shifts. Red bars pushed the model toward the predicted class, teal bars pushed against it."}
          </p>
          <p className="mt-3 text-xs text-mute">
            These are explainability visualisations for an educational prototype, not a medical
            finding.
          </p>
        </div>
      </div>
    </div>
  );
}
