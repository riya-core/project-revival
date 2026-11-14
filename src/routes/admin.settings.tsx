import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Card, Field, SectionTitle, Select } from "@/components/common/ui";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { useApp } from "@/context/AppContext";

export const Route = createFileRoute("/admin/settings")({
  head: () => ({
    meta: [
      { title: "System settings — DermaAI" },
      { name: "description", content: "Tune the confidence threshold and model options for DermaAI." },
      { property: "og:title", content: "System settings — DermaAI" },
      {
        property: "og:description",
        content: "Tune the confidence threshold and model options for DermaAI.",
      },
    ],
  }),
  component: () => (
    <DashboardLayout role="admin">
      <Inner />
    </DashboardLayout>
  ),
});

function Inner() {
  const { threshold, setThreshold, predictions } = useApp();
  const [local, setLocal] = useState(threshold);
  const [model, setModel] = useState("DermaNet-v2 (simulated)");
  const [explain, setExplain] = useState("Grad-CAM");
  const [saved, setSaved] = useState(false);

  const flagged = predictions.filter((p) => p.confidence < local).length;

  return (
    <>
      <SectionTitle eyebrow="Settings" title="System settings" />

      <Card className="p-5">
        <div className="text-sm font-semibold">Confidence threshold</div>
        <p className="mt-1 text-sm text-mute">
          Predictions below this score are flagged for dermatologist review.
        </p>
        <div className="mt-4 flex items-center gap-4">
          <input
            type="range"
            min={40}
            max={95}
            value={local}
            onChange={(e) => setLocal(Number(e.target.value))}
            className="w-full accent-brand"
          />
          <span className="font-display text-xl font-semibold">{local}%</span>
        </div>
        <div className="mt-2 text-xs text-mute">
          {flagged} of {predictions.length} existing predictions would be flagged at this setting.
        </div>
      </Card>

      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Active model" hint="Simulated — no real inference is performed">
            <Select value={model} onChange={(e) => setModel(e.target.value)}>
              <option>DermaNet-v2 (simulated)</option>
              <option>DermaNet-v1 (simulated)</option>
              <option>ResNet-50 baseline (simulated)</option>
            </Select>
          </Field>
          <Field label="Default explanation method">
            <Select value={explain} onChange={(e) => setExplain(e.target.value)}>
              <option>Grad-CAM</option>
              <option>LIME</option>
            </Select>
          </Field>
        </div>
        <div className="mt-5 flex items-center gap-3">
          <Button
            onClick={() => {
              setThreshold(local);
              setSaved(true);
              setTimeout(() => setSaved(false), 2500);
            }}
          >
            Save settings
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setLocal(70);
              setThreshold(70);
            }}
          >
            Reset to default
          </Button>
          {saved ? <span className="text-sm font-medium text-brandink">Settings saved</span> : null}
        </div>
      </Card>

      <p className="text-xs text-mute">
        These controls affect the prototype's mock behaviour only. No model is retrained or
        deployed.
      </p>
    </>
  );
}
