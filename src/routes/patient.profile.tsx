import { createFileRoute } from "@tanstack/react-router";
import { ProfilePage } from "@/components/common/ProfilePage";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";

export const Route = createFileRoute("/patient/profile")({
  head: () => ({
    meta: [
      { title: "My profile — DermaAI" },
      { name: "description", content: "Update your patient details and review your scan activity." },
      { property: "og:title", content: "My profile — DermaAI" },
      {
        property: "og:description",
        content: "Update your patient details and review your scan activity.",
      },
    ],
  }),
  component: () => (
    <DashboardLayout role="patient">
      <ProfilePage role="patient" />
    </DashboardLayout>
  ),
});
