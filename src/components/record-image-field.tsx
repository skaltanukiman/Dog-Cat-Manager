"use client";

import { ImagePlus, Trash2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { MAX_IMAGE_UPLOAD_SIZE_BYTES, SUPPORTED_IMAGE_MIME_TYPES } from "@/lib/image-constraints";

type RecordImageFieldProps = {
  recordId?: string;
  hasCurrentImage?: boolean;
  disabled?: boolean;
};

export function RecordImageField({
  recordId,
  hasCurrentImage = false,
  disabled = false
}: RecordImageFieldProps) {
  const inputId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const removeInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removeCurrent, setRemoveCurrent] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => {
    removeInputRef.current?.form?.dispatchEvent(new Event("change", { bubbles: true }));
  }, [removeCurrent]);

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
    <div className="grid gap-2">
      <span className="text-sm font-medium text-slate-700">写真（JPEG / PNG / WebP、元画像10MBまで）</span>
      <input
        ref={removeInputRef}
        type="hidden"
        name="removeImage"
        value={removeCurrent ? "true" : "false"}
        data-dirty-control
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="grid h-36 w-full place-items-center overflow-hidden rounded-md border border-slate-200 bg-slate-50 sm:w-48">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="選択した思い出写真のプレビュー" className="h-full w-full object-cover" />
          ) : hasCurrentImage && recordId && !removeCurrent && !imageFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/pet-records/${encodeURIComponent(recordId)}/image`}
              alt="登録済みの思い出写真"
              className="h-full w-full object-cover"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <span className="px-3 text-center text-sm text-slate-500">写真は登録されていません</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <label
            htmlFor={inputId}
            className={`inline-flex h-10 items-center gap-2 rounded-md border px-4 text-sm font-semibold ${
              disabled ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400" : "cursor-pointer border-brand text-brand hover:bg-brand-dark hover:text-white"
            }`}
          >
            <ImagePlus className="h-4 w-4" aria-hidden />
            写真を選択
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            name="image"
            accept="image/jpeg,image/png,image/webp"
            disabled={disabled}
            className="sr-only"
            aria-invalid={validationError ? "true" : undefined}
            aria-describedby={validationError ? errorId : undefined}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.currentTarget.setCustomValidity("");
              setValidationError(null);
              if (previewUrl) URL.revokeObjectURL(previewUrl);
              setPreviewUrl(null);
              if (file) {
                const error = file.size > MAX_IMAGE_UPLOAD_SIZE_BYTES
                  ? "思い出の写真は10MB以内で選択してください。"
                  : !(SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)
                    ? "思い出の写真はJPEG、PNG、WebP形式を選択してください。"
                    : null;
                if (error) {
                  event.currentTarget.setCustomValidity(error);
                  setValidationError(error);
                  return;
                }
                setPreviewUrl(URL.createObjectURL(file));
                setRemoveCurrent(false);
              }
            }}
          />
          {previewUrl || validationError ? (
            <button type="button" onClick={clearSelection} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <X className="h-4 w-4" aria-hidden />選択解除
            </button>
          ) : hasCurrentImage && !removeCurrent ? (
            <button
              type="button"
              onClick={() => {
                setRemoveCurrent(true);
              }}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-red-200 px-4 text-sm font-semibold text-red-600 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" aria-hidden />写真を削除
            </button>
          ) : null}
        </div>
      </div>
      <p className="text-xs text-slate-500">縦横比を保ったまま長辺1920px以内のWebPへ変換し、2MB以下に圧縮して保存します。</p>
      {validationError ? <p id={errorId} role="alert" className="text-sm text-red-600">{validationError}</p> : null}
    </div>
  );
}
