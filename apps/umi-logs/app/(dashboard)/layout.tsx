import { Sidebar } from "@/components/Sidebar";
import { getSessionUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { businesses } = await getSessionUser();

  // Fetch business names for the selector
  const businessIds = businesses.map((b) => b.businessId);
  const { data: businessRows } = await supabase
    .from('businesses')
    .select('id, name')
    .in('id', businessIds);

  const businessList = businesses.map((b) => ({
    businessId: b.businessId,
    label: businessRows?.find((r) => r.id === b.businessId)?.name ?? b.businessId,
  }));

  return (
    <>
      <Sidebar businesses={businessList} />
      <main className="pl-[48px] p-3 min-h-screen overflow-auto">
        {children}
      </main>
    </>
  );
}
