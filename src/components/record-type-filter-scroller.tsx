"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type RecordTypeFilterScrollerProps = {
  children: ReactNode;
};

type IndicatorPosition = {
  thumbWidth: number;
  thumbOffset: number;
};

/**
 * Recordsの種類filterをネイティブに横スクロールし、overflow時だけ現在位置を示すindicatorを表示する。
 * LinkやURLの生成はServer Componentに残すため、このコンポーネントは表示領域の計測だけを担う。
 */
export function RecordTypeFilterScroller({ children }: RecordTypeFilterScrollerProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [indicatorPosition, setIndicatorPosition] = useState<IndicatorPosition | null>(null);

  const updateIndicator = useCallback(() => {
    const scrollContainer = scrollContainerRef.current;

    if (!scrollContainer) {
      return;
    }

    const { clientWidth, scrollLeft, scrollWidth } = scrollContainer;

    // 1pxの丸め誤差で表示が切り替わらないよう、わずかな余裕を持たせる。
    if (clientWidth === 0 || scrollWidth <= clientWidth + 1) {
      setIndicatorPosition(null);
      return;
    }

    const thumbWidth = clientWidth * (clientWidth / scrollWidth);
    const maxScroll = scrollWidth - clientWidth;
    const thumbTravel = clientWidth - thumbWidth;
    const thumbOffset = maxScroll === 0 ? 0 : (scrollLeft / maxScroll) * thumbTravel;

    setIndicatorPosition({ thumbWidth, thumbOffset });
  }, []);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    const content = contentRef.current;

    if (!scrollContainer || !content) {
      return;
    }

    const resizeObserver = new ResizeObserver(updateIndicator);
    resizeObserver.observe(scrollContainer);
    resizeObserver.observe(content);
    scrollContainer.addEventListener("scroll", updateIndicator, { passive: true });
    updateIndicator();

    return () => {
      resizeObserver.disconnect();
      scrollContainer.removeEventListener("scroll", updateIndicator);
    };
  }, [updateIndicator]);

  return (
    <div className="min-w-0 max-w-full">
      <div ref={scrollContainerRef} className="record-filter-scroll min-w-0 max-w-full overflow-x-auto overscroll-x-contain">
        <div ref={contentRef} className="flex w-max flex-nowrap gap-2 whitespace-nowrap">
          {children}
        </div>
      </div>
      {indicatorPosition ? (
        <div className="relative mt-2 flex h-1 items-center" aria-hidden="true">
          <div className="absolute inset-x-0 h-[3px] rounded-full bg-slate-200" />
          <div
            className="absolute h-1 rounded-full bg-brand/75"
            style={{ transform: `translateX(${indicatorPosition.thumbOffset}px)`, width: `${indicatorPosition.thumbWidth}px` }}
          />
        </div>
      ) : null}
    </div>
  );
}
