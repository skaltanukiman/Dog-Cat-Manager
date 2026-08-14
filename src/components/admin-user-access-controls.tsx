"use client";

import { EllipsisVertical } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal, useFormStatus } from "react-dom";

import { restoreUserAccess, suspendUserAccess } from "@/app/actions/admin";
import type { AdminRoleReturnPath } from "@/lib/admin-users";
import {
  USER_RESTORE_NOTE_MAX_LENGTH,
  USER_SUSPENSION_REASON_MAX_LENGTH,
  USER_SUSPENSION_REASON_MIN_LENGTH
} from "@/lib/user-access-constants";

type AccessMode = "suspend" | "restore" | null;
type MenuPosition = { top?: number; bottom?: number; right: number };

function SubmitButton({ mode }: { mode: Exclude<AccessMode, null> }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={`inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 ${
        mode === "suspend" ? "bg-red-700 hover:bg-red-800" : "bg-brand hover:bg-brand-dark"
      }`}
    >
      {pending ? "処理中..." : mode === "suspend" ? "利用停止を確定する" : "利用停止解除を確定する"}
    </button>
  );
}

export function AdminUserAccessControls({
  user,
  returnPath,
  presentation = "button",
  suspensionDetails
}: {
  user: {
    id: string;
    name: string | null;
    email: string | null;
    accessStatus: "ACTIVE" | "SUSPENDED";
  };
  returnPath: AdminRoleReturnPath;
  presentation?: "button" | "menu";
  suspensionDetails?: {
    suspendedAt: string;
    reason: string;
    actorName: string;
  };
}) {
  const [mode, setMode] = useState<AccessMode>(null);
  const [reason, setReason] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const menuId = useId();
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const actionTriggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isMenuOpen) return;

    function closeMenuForOutsidePointer(event: PointerEvent) {
      const target = event.target as Node;
      if (!menuTriggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setIsMenuOpen(false);
      }
    }

    function closeMenuForViewportChange() {
      setIsMenuOpen(false);
    }

    document.addEventListener("pointerdown", closeMenuForOutsidePointer);
    window.addEventListener("resize", closeMenuForViewportChange);
    window.addEventListener("scroll", closeMenuForViewportChange, true);

    return () => {
      document.removeEventListener("pointerdown", closeMenuForOutsidePointer);
      window.removeEventListener("resize", closeMenuForViewportChange);
      window.removeEventListener("scroll", closeMenuForViewportChange, true);
    };
  }, [isMenuOpen]);

  function close() {
    setMode(null);
    setReason("");
    window.requestAnimationFrame(() => {
      (presentation === "menu" ? menuTriggerRef : actionTriggerRef).current?.focus();
    });
  }

  const isSuspended = user.accessStatus === "SUSPENDED";

  function menuItems() {
    return Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? []);
  }

  function openMenu(focusLast = false) {
    const trigger = menuTriggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const estimatedHeight = isSuspended && suspensionDetails ? 96 : 48;
    const openAbove = window.innerHeight - rect.bottom < estimatedHeight + 16 && rect.top > estimatedHeight + 16;
    setMenuPosition({
      ...(openAbove ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
      right: Math.max(8, window.innerWidth - rect.right)
    });
    setIsMenuOpen(true);
    window.requestAnimationFrame(() => {
      const items = menuItems();
      (focusLast ? items.at(-1) : items[0])?.focus();
    });
  }

  function closeMenu({ restoreFocus = false } = {}) {
    setIsMenuOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => menuTriggerRef.current?.focus());
  }

  function handleMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const items = menuItems();
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);

    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu({ restoreFocus: true });
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(currentIndex + 1) % items.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(currentIndex - 1 + items.length) % items.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      items.at(-1)?.focus();
    } else if (event.key === "Tab") {
      closeMenu();
    }
  }

  function openAccessDialog() {
    closeMenu();
    setMode(isSuspended ? "restore" : "suspend");
  }

  return (
    <>
      {presentation === "menu" ? (
        <button
          ref={menuTriggerRef}
          type="button"
          aria-label={`${user.name || user.email || "ユーザー"}の操作メニューを開く`}
          aria-expanded={isMenuOpen}
          aria-haspopup="menu"
          aria-controls={menuId}
          title="操作メニュー"
          onClick={() => (isMenuOpen ? closeMenu() : openMenu())}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              openMenu();
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              openMenu(true);
            } else if (event.key === "Escape") {
              closeMenu({ restoreFocus: true });
            }
          }}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
        >
          <EllipsisVertical className="h-4 w-4" aria-hidden />
        </button>
      ) : (
        <button
          ref={actionTriggerRef}
          type="button"
          onClick={openAccessDialog}
          className={`inline-flex h-9 w-full items-center justify-center whitespace-nowrap rounded-md border px-3 text-sm font-semibold sm:w-auto ${
            isSuspended
              ? "border-brand text-brand hover:bg-brand-dark hover:text-white"
              : "border-red-300 text-red-700 hover:bg-red-50"
          }`}
        >
          {isSuspended ? "利用停止解除" : "利用停止"}
        </button>
      )}

      {presentation === "menu" && isMenuOpen && menuPosition && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-label={`${user.name || user.email || "ユーザー"}の操作`}
              onKeyDown={handleMenuKeyDown}
              style={menuPosition}
              className="fixed z-40 w-44 rounded-lg border border-slate-200 bg-white p-1.5 text-left shadow-lg shadow-slate-900/10"
            >
              {isSuspended && suspensionDetails ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeMenu();
                    setIsDetailsOpen(true);
                  }}
                  className="flex w-full items-center whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  停止情報の詳細
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                onClick={openAccessDialog}
                className={`flex w-full items-center whitespace-nowrap rounded-md px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                  isSuspended ? "text-brand hover:bg-brand/10" : "text-red-700 hover:bg-red-50"
                }`}
              >
                {isSuspended ? "利用停止解除" : "利用停止"}
              </button>
            </div>,
            document.body
          )
        : null}

      {isDetailsOpen && suspensionDetails ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={`user-access-details-title-${user.id}`}
            className="max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-xl sm:p-6"
          >
            <h3 id={`user-access-details-title-${user.id}`} className="text-lg font-bold text-ink">
              利用停止情報
            </h3>
            <dl className="mt-4 grid gap-4 text-sm">
              <div>
                <dt className="text-xs font-semibold text-slate-500">対象ユーザー</dt>
                <dd className="mt-1 break-words font-semibold text-ink [overflow-wrap:anywhere]">
                  {user.name || "未設定"}
                </dd>
                <dd className="mt-0.5 break-words text-xs text-slate-500 [overflow-wrap:anywhere]">
                  {user.email || "未設定"}
                </dd>
              </div>
              <div className="border-t border-slate-100 pt-4">
                <dt className="text-xs font-semibold text-slate-500">利用停止日時</dt>
                <dd className="mt-1 text-slate-700">{suspensionDetails.suspendedAt}</dd>
              </div>
              <div className="border-t border-slate-100 pt-4">
                <dt className="text-xs font-semibold text-slate-500">利用停止理由（管理者向け）</dt>
                <dd className="mt-1 break-words whitespace-pre-wrap text-slate-700 [overflow-wrap:anywhere]">
                  {suspensionDetails.reason}
                </dd>
              </div>
              <div className="border-t border-slate-100 pt-4">
                <dt className="text-xs font-semibold text-slate-500">実行者</dt>
                <dd className="mt-1 break-words text-slate-700 [overflow-wrap:anywhere]">
                  {suspensionDetails.actorName}
                </dd>
              </div>
            </dl>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setIsDetailsOpen(false);
                  window.requestAnimationFrame(() => menuTriggerRef.current?.focus());
                }}
                className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                閉じる
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {mode ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={`user-access-title-${user.id}`}
            className="max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-xl sm:p-6"
          >
            <h3 id={`user-access-title-${user.id}`} className="text-lg font-bold text-ink">
              {mode === "suspend" ? "ユーザーを利用停止しますか？" : "ユーザーの利用停止を解除しますか？"}
            </h3>

            <dl className="mt-4 grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm">
              <div>
                <dt className="text-xs font-semibold text-slate-500">対象ユーザー名</dt>
                <dd className="mt-1 break-words font-semibold text-ink [overflow-wrap:anywhere]">
                  {user.name || "未設定"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-slate-500">メールアドレス</dt>
                <dd className="mt-1 break-words text-slate-700 [overflow-wrap:anywhere]">
                  {user.email || "未設定"}
                </dd>
              </div>
            </dl>

            {mode === "suspend" ? (
              <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800">
                <p className="font-semibold">アカウントや飼育データ、共有グループは削除されません。</p>
                <p>現在の全セッションが無効化され、解除されるまでアプリを利用できなくなります。</p>
              </div>
            ) : (
              <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-800">
                <p className="font-semibold">保存済みのアカウントや飼育データはそのまま利用できます。</p>
                <p>解除後は、同じGoogleアカウントで通常どおりログインできます。</p>
              </div>
            )}

            <form action={mode === "suspend" ? suspendUserAccess : restoreUserAccess} className="mt-5 grid gap-4">
              <input type="hidden" name="userId" value={user.id} />
              <input type="hidden" name="returnTo" value={returnPath} />
              {mode === "suspend" ? (
                <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                  利用停止理由（管理者向け・必須）
                  <textarea
                    name="reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    required
                    minLength={USER_SUSPENSION_REASON_MIN_LENGTH}
                    maxLength={USER_SUSPENSION_REASON_MAX_LENGTH}
                    rows={5}
                    className="min-h-28 resize-y"
                    placeholder="利用停止の根拠を入力してください。ユーザー本人には表示されません。"
                  />
                  <span className="text-xs font-normal text-slate-500">
                    前後の空白を除いて{USER_SUSPENSION_REASON_MIN_LENGTH}〜{USER_SUSPENSION_REASON_MAX_LENGTH}文字
                  </span>
                </label>
              ) : (
                <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                  解除理由・備考（任意）
                  <textarea
                    name="note"
                    maxLength={USER_RESTORE_NOTE_MAX_LENGTH}
                    rows={4}
                    className="min-h-24 resize-y"
                    placeholder="必要に応じて解除の経緯を入力してください。"
                  />
                  <span className="text-xs font-normal text-slate-500">
                    最大{USER_RESTORE_NOTE_MAX_LENGTH}文字
                  </span>
                </label>
              )}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={close}
                  className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  キャンセル
                </button>
                <SubmitButton mode={mode} />
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
