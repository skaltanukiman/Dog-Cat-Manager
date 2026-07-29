"use client";

import { useRouter } from "next/navigation";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { FORM_DIRTY_REEVALUATE_EVENT, hasDirtyForms } from "@/components/form-dirty-state";

type UnsavedChangesGuardProps = {
  children: ReactNode;
};

export function UnsavedChangesGuard({ children }: UnsavedChangesGuardProps) {
  const router = useRouter();
  const [isDirty, setIsDirty] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  function handleChangeCapture(event: FormEvent<HTMLDivElement>) {
    if (event.target instanceof HTMLElement && event.target.closest("[data-dirty-watch]")) {
      window.requestAnimationFrame(() => {
        setIsDirty(hasDirtyForms());
      });
    }
  }

  function handleSubmitCapture(event: FormEvent<HTMLDivElement>) {
    if (event.target instanceof HTMLFormElement && event.target.matches("[data-dirty-watch]")) {
      setIsDirty(false);
    }
  }

  useEffect(() => {
    // 初回描画時の値を差分比較の基準として記録する。
    hasDirtyForms();
  }, []);

  useEffect(() => {
    let dirtyReevaluationFrame: number | null = null;

    function handleDirtyReevaluation(event: Event) {
      const form = (event as CustomEvent<{ form?: unknown }>).detail?.form;

      if (!(form instanceof HTMLFormElement) || !form.matches("[data-dirty-watch]")) {
        return;
      }

      if (dirtyReevaluationFrame !== null) {
        window.cancelAnimationFrame(dirtyReevaluationFrame);
      }

      dirtyReevaluationFrame = window.requestAnimationFrame(() => {
        dirtyReevaluationFrame = null;
        setIsDirty(hasDirtyForms());
      });
    }

    document.addEventListener(FORM_DIRTY_REEVALUATE_EVENT, handleDirtyReevaluation);
    return () => {
      if (dirtyReevaluationFrame !== null) {
        window.cancelAnimationFrame(dirtyReevaluationFrame);
      }
      document.removeEventListener(FORM_DIRTY_REEVALUATE_EVENT, handleDirtyReevaluation);
    };
  }, []);

  useEffect(() => {
    function handleDocumentClick(event: MouseEvent) {
      if (
        !isDirty ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      if (!(event.target instanceof Element)) {
        return;
      }

      const anchor = event.target.closest("a[href]");

      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute("download") || anchor.target === "_blank") {
        return;
      }

      const nextUrl = new URL(anchor.href, window.location.href);
      const currentUrl = new URL(window.location.href);

      if (
        nextUrl.origin === currentUrl.origin &&
        nextUrl.pathname === currentUrl.pathname &&
        nextUrl.search === currentUrl.search
      ) {
        return;
      }

      event.preventDefault();
      setPendingHref(nextUrl.href);
      setIsModalOpen(true);
    }

    document.addEventListener("click", handleDocumentClick, true);

    return () => {
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, [isDirty]);

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!isDirty) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isDirty]);

  function handleStay() {
    setPendingHref(null);
    setIsModalOpen(false);
  }

  function handleDiscardAndNavigate() {
    const href = pendingHref;

    setIsDirty(false);
    setPendingHref(null);
    setIsModalOpen(false);

    if (!href) {
      return;
    }

    const nextUrl = new URL(href, window.location.href);

    if (nextUrl.origin === window.location.origin) {
      router.push(`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
      return;
    }

    window.location.assign(nextUrl.href);
  }

  const modal = (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unsaved-changes-title"
    >
      <div className="w-full max-w-md rounded-md border border-slate-200 bg-white p-5 shadow-xl">
        <h2 id="unsaved-changes-title" className="text-lg font-bold text-ink">
          保存されていない変更があります
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          このまま移動すると、入力中の内容は保存されずに破棄されます。移動してもよろしいですか？
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={handleStay}
            className="inline-flex h-10 items-center justify-center rounded-md border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            編集を続ける
          </button>
          <button
            type="button"
            onClick={handleDiscardAndNavigate}
            className="inline-flex h-10 items-center justify-center rounded-md bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700"
          >
            破棄して移動
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div onChangeCapture={handleChangeCapture} onSubmitCapture={handleSubmitCapture}>
      {children}

      {/* transform/animation を持つ親要素の影響を避けるため、モーダルは body 直下に出す。 */}
      {isModalOpen ? createPortal(modal, document.body) : null}
    </div>
  );
}
