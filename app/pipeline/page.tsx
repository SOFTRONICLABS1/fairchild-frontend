import Link from "next/link";
import TopNav from "@/components/flow/top-nav";

export default function PipelinePage() {
  return (
    <>
      <TopNav right={<div className="text-sm text-slate-500">Results / <span className="font-medium text-slate-800">Pipeline</span></div>} />
      <div className="page-wrap">
        <h2 className="mb-1 text-[18px] font-medium">Run pipeline</h2>
        <p className="mb-4 text-sm text-slate-500">2 products selected · configure options and start</p>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="card p-4">
              <p className="mb-3 text-sm font-medium">Selected products</p>
              <div className="mb-2 flex items-center justify-between rounded-md border border-slate-200 p-2"><div><p className="text-sm font-medium">Sony WH-1000XM5</p><p className="text-xs text-slate-500">$279.99 · CJ Affiliate</p></div><span className="badge" style={{ background: "var(--ok-bg)", color: "var(--ok-tx)" }}>Done</span></div>
              <div className="flex items-center justify-between rounded-md border border-slate-200 p-2"><div><p className="text-sm font-medium">Logitech MX Master 3S</p><p className="text-xs text-slate-500">$89.99 · Impact</p></div><span className="badge" style={{ background: "var(--warn-bg)", color: "var(--warn-tx)" }}>Running</span></div>
            </div>

            <div className="card p-4">
              <p className="mb-3 text-sm font-medium">Options</p>
              <div className="space-y-2 text-sm text-slate-700">
                <div className="flex items-center justify-between rounded-md border border-slate-200 p-2"><span>Create WordPress post</span><span>On</span></div>
                <div className="flex items-center justify-between rounded-md border border-slate-200 p-2"><span>Schedule to Metricool</span><span>On</span></div>
                <div className="flex items-center justify-between rounded-md border border-slate-200 p-2"><span>GPT-generated content</span><span>On</span></div>
                <div className="flex items-center justify-between rounded-md border border-slate-200 p-2"><span>Edit image (resize + watermark)</span><span>On</span></div>
              </div>
              <Link href="/history" className="btn-primary mt-3 inline-block">Start pipeline</Link>
            </div>
          </div>

          <div className="space-y-4">
            <div className="card p-4">
              <p className="mb-2 text-sm font-medium">Logitech MX Master 3S — live status</p>
              <div className="mb-1 flex justify-between text-xs text-slate-500"><span>Progress</span><span>3 / 6 steps</span></div>
              <div className="mb-3 h-2 overflow-hidden rounded bg-slate-200"><div className="h-full w-1/2 bg-[#185FA5]" /></div>
              <div className="space-y-2 text-sm">
                <div className="rounded border border-emerald-200 bg-emerald-50 p-2">1. Download image - done</div>
                <div className="rounded border border-emerald-200 bg-emerald-50 p-2">2. Edit image - done</div>
                <div className="rounded border border-emerald-200 bg-emerald-50 p-2">3. Create post package - done</div>
                <div className="rounded border border-[#185FA5] bg-[#E6F1FB] p-2">4. Upload to WordPress media - running</div>
                <div className="rounded border border-slate-200 bg-white p-2">5. Create WordPress post - waiting</div>
                <div className="rounded border border-slate-200 bg-white p-2">6. Schedule to Metricool - waiting</div>
              </div>
            </div>

            <div className="card p-4">
              <p className="mb-2 text-sm font-medium">Sony WH-1000XM5 — completed</p>
              <div className="flex justify-between border-b border-slate-200 py-2 text-sm"><span className="text-slate-500">WordPress post</span><span className="text-[#185FA5]">yoursite.com/sony-wh-1000xm5</span></div>
              <div className="flex justify-between border-b border-slate-200 py-2 text-sm"><span className="text-slate-500">WP post ID</span><span>#4821</span></div>
              <div className="flex justify-between py-2 text-sm"><span className="text-slate-500">Metricool post</span><span className="text-emerald-700">Scheduled for tomorrow 9am</span></div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
