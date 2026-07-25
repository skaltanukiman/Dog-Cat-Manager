"use client";

import { PawPrint, X } from "lucide-react";
import { useEffect, useId, useState } from "react";

type HamsterThumbnailProps = {
  hamsterId: string;
  hamsterName: string;
  profileImageFileName: string | null;
  staticImagePath?: string | null;
  size?: "dashboard" | "management";
};

export function HamsterThumbnail({
  hamsterId,
  hamsterName,
  profileImageFileName,
  staticImagePath = null,
  size = "dashboard"
}: HamsterThumbnailProps) {
  const dialogTitleId = useId();
  const [failedVersion, setFailedVersion] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const imageVersion = staticImagePath ?? profileImageFileName;
  const showImage = Boolean(imageVersion && failedVersion !== imageVersion);
  const sizeClass = size === "dashboard" ? "h-24 w-24 md:h-28 md:w-28" : "h-24 w-24";
  const imageUrl =
    staticImagePath ??
    `/api/hamsters/${encodeURIComponent(hamsterId)}/image?v=${encodeURIComponent(profileImageFileName ?? "")}`;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  function handleImageError() {
    setFailedVersion(imageVersion);
    setIsOpen(false);
  }

  return (
    <>
      {showImage ? (
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={`${hamsterName}のプロフィール画像を拡大表示`}
          title="クリックして拡大表示"
          onClick={() => setIsOpen(true)}
          className={`${sizeClass} flex shrink-0 cursor-zoom-in items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 shadow-sm transition hover:border-moss focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss`}
        >
          {/* 通常画像は認証Cookie付きAPI、デモ画像はpublic配下の固定パスを直接参照する。 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={`${hamsterName}のプロフィール画像`}
            className="h-full w-full object-cover"
            onError={handleImageError}
          />
        </button>
      ) : (
        <div
          className={`${sizeClass} flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-slate-400 shadow-sm`}
          role="img"
          aria-label={`${hamsterName}のプロフィール画像は未登録です`}
        >
          <PawPrint className="h-10 w-10" aria-hidden />
        </div>
      )}

      {isOpen && showImage ? (
        <div
          role="presentation"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 px-4 py-6"
          onClick={() => setIsOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-md bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3 sm:px-5">
              <h3 id={dialogTitleId} className="min-w-0 truncate text-base font-bold text-ink">
                {hamsterName}のプロフィール画像
              </h3>
              <button
                type="button"
                aria-label="プロフィール画像を閉じる"
                onClick={() => setIsOpen(false)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-950 p-3 sm:p-5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt={`${hamsterName}のプロフィール画像（拡大表示）`}
                className="max-h-[75vh] max-w-full object-contain"
                onError={handleImageError}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
