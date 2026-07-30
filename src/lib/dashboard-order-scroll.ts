export type DashboardOrderScrollMetrics = {
  currentScrollTop: number;
  maxScrollTop: number;
  listTop: number;
  listBottom: number;
  rowTop: number;
  rowBottom: number;
};

export function getDashboardOrderScrollTop({
  currentScrollTop,
  maxScrollTop,
  listTop,
  listBottom,
  rowTop,
  rowBottom
}: DashboardOrderScrollMetrics) {
  let scrollDelta = 0;

  if (rowTop < listTop) {
    scrollDelta = rowTop - listTop;
  } else if (rowBottom > listBottom) {
    scrollDelta = rowBottom - listBottom;
  }

  return Math.min(maxScrollTop, Math.max(0, currentScrollTop + scrollDelta));
}
