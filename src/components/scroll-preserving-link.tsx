"use client";

import Link from "next/link";
import { useLayoutEffect, type MouseEvent, type ReactNode } from "react";

const SCROLL_POSITION_STORAGE_KEY = "hamster-manager:pagination-scroll-position";

type StoredScrollPosition = {
  href: string;
  x: number;
  y: number;
};

export function ScrollPreservingLink({
  href,
  className,
  ariaLabel,
  children
}: {
  href: string;
  className: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  useLayoutEffect(() => {
    let animationFrame = 0;

    try {
      const storedValue = window.sessionStorage.getItem(SCROLL_POSITION_STORAGE_KEY);
      if (!storedValue) return;

      const stored = JSON.parse(storedValue) as StoredScrollPosition;
      const destination = new URL(stored.href, window.location.href);
      if (destination.pathname !== window.location.pathname || destination.search !== window.location.search) {
        return;
      }

      window.sessionStorage.removeItem(SCROLL_POSITION_STORAGE_KEY);
      window.scrollTo(stored.x, stored.y);
      animationFrame = window.requestAnimationFrame(() => window.scrollTo(stored.x, stored.y));
    } catch {
      try {
        window.sessionStorage.removeItem(SCROLL_POSITION_STORAGE_KEY);
      } catch {
        // storageが使えない環境では、Next.js標準のスクロール挙動へフォールバックする。
      }
    }

    return () => window.cancelAnimationFrame(animationFrame);
  });

  function saveScrollPosition(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    const stored: StoredScrollPosition = {
      href,
      x: window.scrollX,
      y: window.scrollY
    };

    try {
      window.sessionStorage.setItem(SCROLL_POSITION_STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // storageが使えなくてもscroll={false}は有効なので、画面遷移自体はそのまま継続する。
    }
  }

  return (
    <Link href={href} scroll={false} onClick={saveScrollPosition} className={className} aria-label={ariaLabel}>
      {children}
    </Link>
  );
}
