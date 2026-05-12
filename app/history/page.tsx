import Link from "next/link";
import TopNav, { NavButton } from "@/components/flow/top-nav";

const logs = [
  ["Sony WH-1000XM5", "$279.99 · Sony Electronics", "CJ", "Success", "#4821", "Today, 10:42am"],
  ["Logitech MX Master 3S", "$89.99 · Logitech", "Impact", "Running", "-", "Today, 10:44am"],
  ["Nike Air Max 270", "$139.00 · Nike", "CJ", "Failed", "-", "Yesterday, 3:15pm"],
  ["Canon EOS R50 Camera", "$679.99 · Canon", "Impact", "Success", "#4819", "Yesterday, 1:02pm"]
] as const;

export default function HistoryPage() {
  return (
    <>
      <TopNav right={<><NavButton href="/search" label="New search" /><NavButton href="/settings" label="Settings" /></>} />
      <div className="page-wrap">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[18px] font-medium">Post history</h2>
          <div className="flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-[#E6F1FB] px-3 py-1 text-[#0C447C]">All</span><span className="rounded-full border px-3 py-1">Success</span><span className="rounded-full border px-3 py-1">Failed</span><span className="rounded-full border px-3 py-1">Running</span></div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
          <div className="stat"><p className="text-xl font-medium">142</p><p className="text-xs text-slate-500">Total posts</p></div>
          <div className="stat"><p className="text-xl font-medium text-emerald-700">136</p><p className="text-xs text-slate-500">Succeeded</p></div>
          <div className="stat"><p className="text-xl font-medium text-rose-700">4</p><p className="text-xs text-slate-500">Failed</p></div>
          <div className="stat"><p className="text-xl font-medium text-amber-700">2</p><p className="text-xs text-slate-500">Running</p></div>
        </div>

        <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[880px]">
            <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-3">Product</th><th>Platform</th><th>Status</th><th>WP post</th><th>Date</th><th /></tr></thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log[0]} className="hover:bg-slate-50">
                  <td className="border-t p-3"><p className="text-sm font-medium">{log[0]}</p><p className="text-xs text-slate-500">{log[1]}</p></td>
                  <td className="border-t text-sm"><span className={`badge ${log[2] === "CJ" ? "badge-cj" : "badge-imp"}`}>{log[2]}</span></td>
                  <td className="border-t text-sm">
                    <span className="rounded-full px-2 py-[2px] text-xs" style={log[3] === "Success" ? { background: "var(--ok-bg)", color: "var(--ok-tx)" } : log[3] === "Failed" ? { background: "var(--err-bg)", color: "var(--err-tx)" } : { background: "var(--warn-bg)", color: "var(--warn-tx)" }}>{log[3]}</span>
                  </td>
                  <td className="border-t text-sm">{log[4]}</td>
                  <td className="border-t text-xs text-slate-500">{log[5]}</td>
                  <td className="border-t pr-3 text-right text-sm"><Link href="/pipeline" className="btn-secondary">View</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
