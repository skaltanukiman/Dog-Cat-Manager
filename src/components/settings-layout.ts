export const SETTINGS_CARD_RESPONSIVE_PADDING = "py-5 pl-5 pr-24 sm:pr-24 xl:p-5";

export function shouldShowSettingsScrollButton({
  isIntersecting,
  targetTop,
  viewportBottom
}: {
  isIntersecting: boolean;
  targetTop: number;
  viewportBottom: number;
}) {
  return !isIntersecting && targetTop >= viewportBottom;
}
