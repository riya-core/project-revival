import { createFileRoute } from "@tanstack/react-router";
import { ProfilePage } from "@/components/common/ProfilePage";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";

export const Route = createFileRoute("/admin/profile")({
  head: () => ({
    meta: [
      { title: "Administrator profile — DermaAI" },
      { name: "description", content: "Manage the administrator account for the DermaAI prototype." },
      { property: "og:title", content: "Administrator profile — DermaAI" },
      {
        property: "og:description",
        content: "Manage the administrator account for the DermaAI prototype.",
      },
    ],
  }),
  component: () => (
    <DashboardLayout role="admin">
      <ProfilePage role="admin" />
    </DashboardLayout>
  ),
});
