"use client";

import { ImagePlus, Trash2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { PetThumbnail } from "@/components/pet-thumbnail";
import { MAX_IMAGE_UPLOAD_SIZE_BYTES, SUPPORTED_IMAGE_MIME_TYPES } from "@/lib/image-constraints";

type PetImageFieldProps = {
  petId?: string;
  petName?: string;
  currentFileName?: string | null;
  disabled?: boolean;
};

export function PetImageField({
  petId,
  petName = "Pet",
  currentFileName = null,
  disabled = false
}: PetImageFieldProps) {
  const inputId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removeCurrent, setRemoveCurrent] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function clearSelection() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setValidationError(null);
    if (inputRef.current) {
      inputRef.current.setCustomValidity("");
      inputRef.current.value = "";
      inputRef.current.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  return (
    <fieldset className="min-w-0 rounded-md border border-slate-200 bg-slate-50 p-3">
      <legend className="px-1 text-sm font-semibold text-slate-700">
        プロフィール画像
        <span className="ml-1 text-xs font-normal text-slate-500">（任意）</span>
      </legend>
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
        {previewUrl ? (
          // blob URLはローカル選択内容の即時プレビューだけに使用する。
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt={`${petName}に選択したプロフィール画像のプレビュー`} className="h-24 w-24 shrink-0 rounded-full border border-slate-200 object-cover" />
        ) : petId && currentFileName && !removeCurrent ? (
          <PetThumbnail petId={petId} petName={petName} profileImageFileName={currentFileName} size="management" />
        ) : (
          <div
            className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full border border-dashed border-slate-300 bg-white text-slate-400"
            role="img"
            aria-label={`${petName}のプロフィール画像は未登録です`}
          >
            <ImagePlus className="h-7 w-7" aria-hidden />
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-2">
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            name="profileImage"
            accept="image/jpeg,image/png,image/webp"
            disabled={disabled}
            className="block w-full min-w-0 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand file:px-3 file:py-2 file:font-semibold file:text-white disabled:cursor-not-allowed disabled:opacity-60"
            aria-invalid={validationError ? "true" : undefined}
            aria-describedby={validationError ? errorId : undefined}
            onChange={(event) => {
              if (previewUrl) URL.revokeObjectURL(previewUrl);
              const file = event.currentTarget.files?.[0];
              event.currentTarget.setCustomValidity("");
              setValidationError(null);
              setPreviewUrl(null);
              if (!file) return;

              const error = file.size > MAX_IMAGE_UPLOAD_SIZE_BYTES
                ? "プロフィール画像は10MB以内で選択してください。"
                : !(SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)
                  ? "プロフィール画像はJPEG、PNG、WebP形式を選択してください。"
                  : null;
              if (error) {
                event.currentTarget.setCustomValidity(error);
                setValidationError(error);
                return;
              }

              setPreviewUrl(URL.createObjectURL(file));
              setRemoveCurrent(false);
            }}
          />
          <p className="text-xs leading-5 text-slate-500">
            JPEG、PNG、WebP / 元画像10MB以内。保存時に正方形のWebPへ変換し、2MB以下に圧縮します。
          </p>
          {validationError ? <p id={errorId} role="alert" className="text-sm text-red-600">{validationError}</p> : null}
          <div className="flex flex-wrap gap-2">
            {previewUrl ? (
              <button
                type="button"
                onClick={clearSelection}
                disabled={disabled}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
              >
                <X className="h-3.5 w-3.5" aria-hidden /> 選択を解除
              </button>
            ) : null}
            {currentFileName ? (
              <label
                aria-disabled={disabled}
                title={disabled ? "閲覧者は画像を削除できません" : undefined}
                className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold ${
                  disabled
                    ? "cursor-not-allowed select-none border-slate-300 bg-slate-200 text-slate-500"
                    : "cursor-pointer border-red-200 bg-white text-red-600 hover:bg-red-50"
                }`}
              >
                <input
                  type="checkbox"
                  name="removeProfileImage"
                  value="true"
                  checked={removeCurrent}
                  disabled={disabled}
                  onChange={(event) => setRemoveCurrent(event.currentTarget.checked)}
                  className="sr-only"
                />
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                {removeCurrent ? "削除指定を取り消す" : "登録済み画像を削除"}
              </label>
            ) : null}
          </div>
        </div>
      </div>
    </fieldset>
  );
}
