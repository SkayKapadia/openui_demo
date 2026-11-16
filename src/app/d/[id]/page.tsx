import { LiveDashboard } from "@/components/LiveDashboard";
import { getDashboard } from "@/lib/dashboard-store";
import { dataTools } from "@/lib/data-tools";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

// Always read the saved dashboard from Postgres at request time.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const dashboard = await getDashboard((await params).id);
  return { title: dashboard ? `${dashboard.title} · India Open Data` : "Dashboard not found" };
}

export default async function DashboardPage({ params }: Params) {
  const dashboard = await getDashboard((await params).id);
  if (!dashboard) notFound();

  return (
    <LiveDashboard
      title={dashboard.title}
      prompt={dashboard.prompt}
      source={dashboard.source}
      createdAt={String(dashboard.createdAt)}
      toolNames={Object.keys(dataTools)}
    />
  );
}
