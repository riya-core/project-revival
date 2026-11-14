import { createFileRoute } from "@tanstack/react-router";
import { SectionTitle } from "@/components/common/ui";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { AnalyzeFlow } from "@/components/patient/AnalyzeFlow";

export const Route = createFileRoute("/patient/analyze")({
  head: () => ({
    meta: [
      { title: "Analyze your skin — DermaAI" },
      {
        name: "description",
        content: "Upload a skin image for model-powered triage, confidence, probability and visual explanation results.",
      },
      { property: "og:title", content: "Analyze your skin — DermaAI" },
      {
        property: "og:description",
        content: "Upload a skin image for model-powered triage, confidence, probability and visual explanation results.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AnalyzePage,
});

function AnalyzePage() {
  return (
    <DashboardLayout role="patient">
      <SectionTitle eyebrow="Analysis" title="Analyze your skin" />
      <AnalyzeFlow />
    </DashboardLayout>
  );
}
