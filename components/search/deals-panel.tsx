"use client";

import {
  MIN_DISCOUNT_OPTIONS,
  SORT_OPTIONS,
  clampDiscount,
  hasActiveFilters,
  type SearchIntent
} from "@/lib/search/intent";

function priceToInput(value: number | null): string {
  return value === null ? "" : String(value);
}

function inputToPrice(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export default function DealsPanel({
  intent,
  onChange,
  compact = false
}: {
  intent: SearchIntent;
  onChange: (next: SearchIntent) => void;
  compact?: boolean;
}) {
  const patch = (changes: Partial<SearchIntent>) => {
    const next = { ...intent, ...changes };
    // Any real filter implies Deals is on; clearing them all switches it back off.
    next.dealsEnabled = changes.dealsEnabled ?? (hasActiveFilters(next) || intent.dealsEnabled);
    onChange(next);
  };

  const toggle = () => {
    if (intent.dealsEnabled) {
      onChange({ ...intent, dealsEnabled: false, sort: "relevance", minDiscount: 0, minPrice: null, maxPrice: null });
      return;
    }
    // Turning Deals on with nothing set should do something useful immediately.
    onChange({ ...intent, dealsEnabled: true, sort: "discount-desc", minDiscount: 1 });
  };

  const isCustomDiscount =
    intent.minDiscount > 0 && !MIN_DISCOUNT_OPTIONS.some((option) => option.value === intent.minDiscount);

  return (
    <div className={`text-left ${compact ? "" : "card mb-4 p-3"}`}>
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between gap-2"
        aria-expanded={intent.dealsEnabled}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={`grid h-7 w-7 shrink-0 place-items-center rounded-md text-xs ${
              intent.dealsEnabled ? "bg-[#E7F8F1] text-[#0B6B4B]" : "bg-slate-100 text-slate-400"
            }`}
          >
            %
          </span>
          <span className="truncate text-sm font-medium">Deals</span>
          {/* The sidebar is too narrow for a subtitle; showing it truncates the label. */}
          {compact ? null : (
            <span className="text-xs text-slate-500">
              {intent.dealsEnabled ? "Filtering by discount" : "Find discounted products"}
            </span>
          )}
        </span>
        <span
          className={`relative h-5 w-9 shrink-0 rounded-full transition ${
            intent.dealsEnabled ? "bg-[#185FA5]" : "bg-slate-300"
          }`}
        >
          <span
            className={`absolute top-[2px] h-4 w-4 rounded-full bg-white transition-all ${
              intent.dealsEnabled ? "left-[18px]" : "left-[2px]"
            }`}
          />
        </span>
      </button>

      {intent.dealsEnabled ? (
        <div className="mt-3 border-t border-slate-200 pt-3">
          <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">
            Minimum discount
          </label>
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {MIN_DISCOUNT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => patch({ minDiscount: option.value })}
                className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs transition ${
                  intent.minDiscount === option.value
                    ? "border-[#185FA5] bg-[#E6F1FB] text-[#0C447C]"
                    : "border-slate-300 bg-white text-slate-600"
                }`}
              >
                {option.label}
              </button>
            ))}
            <span className={`flex items-center gap-1 ${compact ? "mt-1 w-full" : ""}`}>
              <input
                type="number"
                min={0}
                max={100}
                placeholder="custom"
                value={isCustomDiscount ? String(intent.minDiscount) : ""}
                onChange={(event) => patch({ minDiscount: clampDiscount(Number(event.target.value)) })}
                className={`field px-2 py-1 text-xs ${compact ? "w-full" : "w-[86px]"}`}
              />
              <span className="text-xs text-slate-500">%</span>
            </span>
          </div>

          {/* Stacked in the sidebar: two inputs plus a separator do not fit at 260px. */}
          <div className={`grid gap-3 ${compact ? "grid-cols-1" : "sm:grid-cols-2"}`}>
            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Price range
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  placeholder="Min $"
                  value={priceToInput(intent.minPrice)}
                  onChange={(event) => patch({ minPrice: inputToPrice(event.target.value) })}
                  className="field w-full min-w-0 px-2 py-1 text-xs"
                />
                <span className="shrink-0 text-xs text-slate-400">to</span>
                <input
                  type="number"
                  min={0}
                  placeholder="Max $"
                  value={priceToInput(intent.maxPrice)}
                  onChange={(event) => patch({ maxPrice: inputToPrice(event.target.value) })}
                  className="field w-full min-w-0 px-2 py-1 text-xs"
                />
              </div>
            </div>
            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Sort by
              </label>
              <select
                className="field w-full py-1 text-xs"
                value={intent.sort}
                onChange={(event) => patch({ sort: event.target.value as SearchIntent["sort"] })}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
