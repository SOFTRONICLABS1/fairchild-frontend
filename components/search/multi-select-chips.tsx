"use client";

export type MultiSelectOption = { value: string; label: string };

/**
 * Dropdown that appends its pick to a chip list below. Picking is additive and each chip
 * carries an X to drop it again, so several advertisers can be combined in one search.
 * An empty selection means "All", which is what both platforms do with no filter.
 */
export default function MultiSelectChips({
  label,
  options,
  selected,
  onChange,
  loading = false,
  error = null,
  emptyLabel = "All",
  compact = false
}: {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  loading?: boolean;
  error?: string | null;
  emptyLabel?: string;
  compact?: boolean;
}) {
  const available = options.filter((option) => !selected.includes(option.value));
  const labelFor = (value: string) => options.find((option) => option.value === value)?.label ?? value;

  return (
    <div className={compact ? "" : "card mb-4 p-3 text-left"}>
      <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">{label}</label>

      <select
        className={`field w-full ${compact ? "py-1 text-xs" : ""}`}
        value=""
        disabled={loading || available.length === 0}
        onChange={(event) => {
          const value = event.target.value;
          if (value) onChange([...selected, value]);
        }}
      >
        <option value="">
          {loading
            ? "Loading..."
            : available.length === 0
              ? selected.length > 0
                ? "All selected"
                : "None available"
              : selected.length === 0
                ? `${emptyLabel}`
                : "Add another..."}
        </option>
        {available.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {selected.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selected.map((value) => (
            <span
              key={value}
              className="flex max-w-full items-center gap-1 rounded-full border border-[#185FA5] bg-[#E6F1FB] px-2 py-[2px] text-xs text-[#0C447C]"
            >
              <span className="truncate">{labelFor(value)}</span>
              <button
                type="button"
                aria-label={`Remove ${labelFor(value)}`}
                onClick={() => onChange(selected.filter((item) => item !== value))}
                className="shrink-0 text-[#0C447C]/60 hover:text-[#0C447C]"
              >
                ✕
              </button>
            </span>
          ))}
          {selected.length > 1 ? (
            <button type="button" onClick={() => onChange([])} className="text-xs text-slate-500 underline">
              Clear
            </button>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-400">{emptyLabel}</p>
      )}

      {error ? <p className="mt-2 text-xs text-amber-700">{error}</p> : null}
    </div>
  );
}
