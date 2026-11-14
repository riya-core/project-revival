import { createFileRoute } from "@tanstack/react-router";
import { ProfilePage } from "@/components/common/ProfilePage";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";

export const Route = createFileRoute("/dermatologist/profile")({
  head: () => ({
    meta: [
      { title: "Dermatologist profile — DermaAI" },
      { name: "description", content: "Manage your clinician account details in DermaAI." },
      { property: "og:title", content: "Dermatologist profile — DermaAI" },
      { property: "og:description", content: "Manage your clinician account details in DermaAI." },
    ],
  }),
  component: () => (
    <DashboardLayout role="dermatologist">
      <ProfilePage role="dermatologist" />
    </DashboardLayout>
  ),
});
