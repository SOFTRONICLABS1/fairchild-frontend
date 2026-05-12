"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";

const items = ["health","cj","impact","wordpress","metricool","renderform"];

export default function Sidebar() {
  const path = usePathname();
  return <aside className="w-full border-r border-slate-200 bg-white p-4 md:w-64">
    <h1 className="mb-4 text-lg font-semibold">Integrations Dashboard</h1>
    <div className="grid gap-2">
      {items.map((x) => <Link key={x} href={`/${x}`} className={cn("rounded px-3 py-2 text-sm capitalize hover:bg-slate-100", path===`/${x}` && "bg-slate-900 text-white hover:bg-slate-900")}>{x}</Link>)}
    </div>
  </aside>;
}
