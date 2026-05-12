import Link from "next/link";
import TopNav from "@/components/flow/top-nav";

const rows = [
  ["Sony WH-1000XM5", "Sony Electronics", "CJ", "$279.99", "30% off", "8.5%", true],
  ["Logitech MX Master 3S", "Logitech", "Impact", "$89.99", "25% off", "6.0%", true],
  ["Jabra Evolve2 65", "Jabra", "CJ", "$199.00", "18% off", "7.2%", false],
  ["Bose QuietComfort 45", "Bose", "Impact", "$249.00", "12% off", "5.5%", false],
  ["Apple AirPods Pro (2nd gen)", "Apple Inc.", "CJ", "$189.00", "6% off", "3.0%", false]
] as const;

export default function ResultsPage() {
  return (
    <>
      <TopNav right={<div className="text-sm text-slate-500">Search / <span className="font-medium text-slate-800">Results</span></div>} />
      <div className="grid min-h-[calc(100vh-58px)] grid-cols-1 md:grid-cols-[220px_1fr]">
        <aside className="border-r border-slate-200 bg-white p-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Platform</p>
          <div className="mb-5 flex gap-2 text-xs"><span className="badge badge-cj">CJ</span><span className="badge badge-imp">Impact</span><span className="rounded-full border px-2 py-[2px] text-[11px] text-slate-500">Both</span></div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Price range</p>
          <input type="range" className="mb-5 w-full" defaultValue={500} max={500} />
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Sort by</p>
          <select className="field mb-5"><option>Discount % (high)</option></select>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Category</p>
          <div className="space-y-1 text-xs text-slate-600">
            <label className="flex items-center gap-2"><input type="checkbox" defaultChecked /> Electronics</label>
            <label className="flex items-center gap-2"><input type="checkbox" /> Fashion</label>
            <label className="flex items-center gap-2"><input type="checkbox" /> Home & Garden</label>
            <label className="flex items-center gap-2"><input type="checkbox" /> Software</label>
          </div>
        </aside>

        <main className="p-4 md:p-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <input className="field w-full max-w-md" defaultValue='Results for "wireless headphones"' />
            <select className="field w-auto"><option>20 per page</option></select>
          </div>
          <p className="mb-2 text-xs text-slate-500">Showing 5 of 84 results · 2 selected</p>

          <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[860px] border-collapse">
              <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-3">Product</th><th>Platform</th><th>Price</th><th>Discount</th><th>Commission</th><th></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r[0]} className={r[6] ? "bg-[#E6F1FB]" : ""}>
                    <td className="border-t border-slate-200 p-3"><p className="text-sm font-medium">{r[0]}</p><p className="text-xs text-slate-500">{r[1]}</p></td>
                    <td className="border-t border-slate-200 text-sm"><span className={`badge ${r[2] === "CJ" ? "badge-cj" : "badge-imp"}`}>{r[2]}</span></td>
                    <td className="border-t border-slate-200 text-sm">{r[3]}</td>
                    <td className="border-t border-slate-200 text-sm"><span className="rounded-full bg-emerald-50 px-2 py-[2px] text-xs text-emerald-700">{r[4]}</span></td>
                    <td className="border-t border-slate-200 text-sm text-emerald-700">{r[5]}</td>
                    <td className="border-t border-slate-200 pr-3 text-right text-slate-400">◦</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-sm text-slate-500"><span className="font-medium text-slate-900">2</span> products selected</p>
            <div className="flex gap-2">
              <Link href="/search" className="btn-secondary">Refine search</Link>
              <Link href="/pipeline" className="btn-primary">Build post package</Link>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
