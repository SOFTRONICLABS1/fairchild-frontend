export const GOOGLE_ADS_ALL_LOCATIONS = "All countries and territories";

export const GOOGLE_ADS_LOCATION_OPTIONS = [
  GOOGLE_ADS_ALL_LOCATIONS,
  "United States",
  "Canada",
  "Mexico",
  "United Kingdom",
  "Ireland",
  "Australia",
  "New Zealand",
  "India",
  "Singapore",
  "United Arab Emirates",
  "Saudi Arabia",
  "Qatar",
  "Kuwait",
  "South Africa",
  "Nigeria",
  "Kenya",
  "Egypt",
  "Germany",
  "France",
  "Spain",
  "Italy",
  "Netherlands",
  "Belgium",
  "Switzerland",
  "Austria",
  "Sweden",
  "Norway",
  "Denmark",
  "Finland",
  "Poland",
  "Czech Republic",
  "Portugal",
  "Greece",
  "Turkey",
  "Romania",
  "Hungary",
  "Japan",
  "South Korea",
  "China",
  "Hong Kong",
  "Taiwan",
  "Thailand",
  "Vietnam",
  "Malaysia",
  "Indonesia",
  "Philippines",
  "Brazil",
  "Argentina",
  "Chile",
  "Colombia",
  "Peru"
] as const;

function normalizeLocationValue(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function normalizeTargetingLocations(values: string[]): string[] {
  const normalizedOptions = GOOGLE_ADS_LOCATION_OPTIONS.map((option) => ({
    label: option,
    normalized: normalizeLocationValue(option)
  }));

  const results: string[] = [];
  for (const rawValue of values) {
    const value = rawValue.trim();
    if (!value) continue;
    const normalizedValue = normalizeLocationValue(value);

    const exact = normalizedOptions.find((item) => item.normalized === normalizedValue);
    if (exact) {
      if (!results.includes(exact.label)) results.push(exact.label);
      continue;
    }

    const partial = normalizedOptions.find(
      (item) => normalizedValue.includes(item.normalized) || item.normalized.includes(normalizedValue)
    );
    if (partial && !results.includes(partial.label)) {
      results.push(partial.label);
    }
  }

  if (results.includes(GOOGLE_ADS_ALL_LOCATIONS)) {
    return [GOOGLE_ADS_ALL_LOCATIONS];
  }

  return results;
}
