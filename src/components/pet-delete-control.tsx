"use client";

import { MoreHorizontal, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal, useFormStatus } from "react-dom";

import { deletePet } from "@/app/actions/pets";

function DeleteSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
    >
      <Trash2 className="h-4 w-4" aria-hidden />
      {pending ? "削除中..." : "完全に削除"}
    </button>
  );
}

/** 管理終了済みPetだけに表示する、取り消せない完全削除の確認UI。 */
export function PetDeleteControl({ petId, petName }: { petId: string; petName: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const triggerButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    const triggerButton = triggerButtonRef.current;
    document.body.style.overflow = "hidden";
    cancelButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      triggerButton?.focus();
    };
  }, [isOpen]);

  const dialog = isOpen && typeof document !== "undefined"
    ? createPortal(
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-900/45 px-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            className="w-full max-w-md rounded-md border border-red-200 bg-white p-5 shadow-2xl"
          >
            <h2 id={titleId} className="text-lg font-bold text-ink">
              {petName}を完全に削除しますか？
            </h2>
            <div id={descriptionId} className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
              <p className="font-semibold text-red-700">この操作は取り消せません。</p>
              <p>過去の記録があるペットは完全削除できません。</p>
            </div>
            <form action={deletePet} className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <input type="hidden" name="id" value={petId} />
              <button
                ref={cancelButtonRef}
                type="button"
                onClick={() => setIsOpen(false)}
                className="inline-flex h-10 flex-1 items-center justify-center rounded-md border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:flex-none"
              >
                キャンセル
              </button>
              <DeleteSubmitButton />
            </form>
          </section>
        </div>,
        document.body
      )
    : null;

  return (
    <div className="mt-4 flex justify-end border-t border-slate-100 pt-3">
      <button
        ref={triggerButtonRef}
        type="button"
        onClick={() => setIsOpen(true)}
        aria-haspopup="dialog"
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-red-50 hover:text-red-700"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
        その他の操作（完全削除）
      </button>
      {dialog}
    </div>
  );
}
