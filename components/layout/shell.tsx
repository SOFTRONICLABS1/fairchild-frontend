import Sidebar from "@/components/layout/sidebar";

export default function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="min-h-screen md:flex"><Sidebar /><main className="flex-1 p-4 md:p-8"><h2 className="mb-4 text-2xl font-semibold">{title}</h2>{children}</main></div>;
}
