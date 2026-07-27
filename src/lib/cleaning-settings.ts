export const CLEANING_MOBILE_DEFAULT_DATE_FILTERS = ["today", "all"] as const;
export const DEFAULT_CLEANING_MOBILE_DATE_FILTER: CleaningMobileDefaultDateFilter = "today";

export type CleaningMobileDefaultDateFilter = (typeof CLEANING_MOBILE_DEFAULT_DATE_FILTERS)[number];

export function normalizeCleaningMobileDefaultDateFilter(
  value: string | null | undefined
): CleaningMobileDefaultDateFilter {
  return value === "today" || value === "all" ? value : DEFAULT_CLEANING_MOBILE_DATE_FILTER;
}

export function resolveCleaningMobileInitialSelectedDate({
  defaultDateFilter,
  yearMonth,
  currentYearMonth,
  today,
  dates
}: {
  defaultDateFilter: string | null | undefined;
  yearMonth: string;
  currentYearMonth: string;
  today: string;
  dates: readonly string[];
}) {
  if (
    normalizeCleaningMobileDefaultDateFilter(defaultDateFilter) !== "today" ||
    yearMonth !== currentYearMonth
  ) {
    return "all";
  }

  return dates.includes(today) ? today : "all";
}
