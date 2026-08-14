"use client";

import { Check, Sparkles, Tags, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";

import { deletePetSavedMemoryTags } from "@/app/actions/pet-memory-records";
import { AutoDismissSuccessMessage } from "@/components/status-message";
import { PET_MEMORY_TAG_SUGGESTIONS } from "@/lib/pet-records";
import { normalizeTagStorageValue } from "@/lib/tags";

const separatorPattern = /[、,]/;

function splitTags(value: string) {
  return value.normalize("NFKC").split(separatorPattern).map(normalizeTagStorageValue).filter(Boolean);
}

function dedupeTags(tags: readonly string[]) {
  const byNormalizedName = new Map<string, string>();
  for (const tag of tags) {
    const normalized = normalizeTagStorageValue(tag);
    if (normalized && !byNormalizedName.has(normalized)) byNormalizedName.set(normalized, tag);
  }
  return Array.from(byNormalizedName.values());
}

export function MemoryTagInput({
  savedTags
}: {
  savedTags: string[];
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [deleteError, setDeleteError] = useState<{ message: string; errorId?: string } | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState<{ key: number; message: string } | null>(null);
  const [isDeletePending, startDeleteTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogTitleId = useId();
  const enteredTagNames = new Set(splitTags(value).map(normalizeTagStorageValue));
  const reusableTags = dedupeTags(savedTags);
  const reusableTagNames = new Set(reusableTags.map(normalizeTagStorageValue));
  const tagSuggestions = PET_MEMORY_TAG_SUGGESTIONS;
  const initialSuggestions = dedupeTags(tagSuggestions).filter(
    (tag) => !reusableTagNames.has(normalizeTagStorageValue(tag))
  );

  useEffect(() => {
    if (!isDeleteDialogOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isDeletePending) setIsDeleteDialogOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDeleteDialogOpen, isDeletePending]);

  function addTag(tag: string) {
    const currentTags = splitTags(value);
    if (currentTags.length >= 20 || enteredTagNames.has(normalizeTagStorageValue(tag))) return;
    const input = inputRef.current;
    setValue([...currentTags, tag].join("、"));
    window.setTimeout(() => input?.dispatchEvent(new Event("input", { bubbles: true })), 0);
  }

  function tagButtons(tags: readonly string[]) {
    return tags.map((tag) => {
      const selected = enteredTagNames.has(normalizeTagStorageValue(tag));
      return (
        <button
          key={tag}
          type="button"
          onClick={() => addTag(tag)}
          disabled={selected}
          aria-pressed={selected}
          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-brand hover:text-brand disabled:border-brand/30 disabled:bg-brand/10 disabled:text-brand"
        >
          {tag}
        </button>
      );
    });
  }

  function openDeleteDialog() {
    setSelectedTags([]);
    setDeleteError(null);
    setIsDeleteDialogOpen(true);
  }

  function toggleDeleteTag(tag: string) {
    setSelectedTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]);
  }

  function deleteSelectedTags() {
    if (selectedTags.length === 0 || isDeletePending) return;
    setDeleteError(null);
    const formData = new FormData();
    selectedTags.forEach((tag) => formData.append("tags", tag));
    startDeleteTransition(async () => {
      const result = await deletePetSavedMemoryTags(formData);
      if (!result.success) {
        setDeleteError({ message: result.errorMessage, errorId: result.errorId });
        return;
      }

      const message = result.deletedCount > 0
        ? `保存済みタグを${result.deletedCount}件削除しました。`
        : "選択したタグはすでに削除されています。";
      setDeleteSuccess((current) => ({ key: (current?.key ?? 0) + 1, message }));
      setSelectedTags([]);
      setIsDeleteDialogOpen(false);
      router.refresh();
    });
  }

  const deleteDialog = isDeleteDialogOpen && typeof document !== "undefined"
    ? createPortal(
      <div
        className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-3 backdrop-blur-[2px] sm:items-center sm:p-6"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !isDeletePending) setIsDeleteDialogOpen(false);
        }}
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby={dialogTitleId}
          className="max-h-[88vh] w-full max-w-2xl overflow-hidden rounded-[1.75rem] border border-rose-100 bg-white shadow-2xl"
        >
          <div className="relative overflow-hidden bg-gradient-to-br from-rose-50 via-amber-50 to-orange-50 px-5 py-5 sm:px-7">
            <div className="pointer-events-none absolute -right-7 -top-8 h-28 w-28 rounded-full bg-white/55" />
            <div className="pointer-events-none absolute right-20 top-4 text-amber-300"><Sparkles className="h-5 w-5" aria-hidden /></div>
            <div className="relative flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-rose-500 shadow-sm">
                  <Tags className="h-5 w-5" aria-hidden />
                </span>
                <div>
                  <h2 id={dialogTitleId} className="text-lg font-bold text-slate-800">保存済みタグのおかたづけ</h2>
                  <p className="mt-1 text-sm text-slate-600">消したいタグを選んで、まとめて削除できます。</p>
                </div>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setIsDeleteDialogOpen(false)}
                disabled={isDeletePending}
                aria-label="タグ削除画面を閉じる"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/80 text-slate-500 shadow-sm hover:bg-white hover:text-slate-700 disabled:opacity-50"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>

          <div className="max-h-[calc(88vh-12rem)] overflow-y-auto px-5 py-5 sm:px-7">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">{selectedTags.length}件選択中</span>
              <div className="flex gap-2 text-xs font-medium">
                <button type="button" onClick={() => setSelectedTags([...reusableTags])} disabled={isDeletePending || selectedTags.length === reusableTags.length} className="rounded-full px-3 py-1.5 text-brand hover:bg-brand/10 disabled:opacity-40">すべて選択</button>
                <button type="button" onClick={() => setSelectedTags([])} disabled={isDeletePending || selectedTags.length === 0} className="rounded-full px-3 py-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40">選択解除</button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {reusableTags.map((tag) => {
                const selected = selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    onClick={() => toggleDeleteTag(tag)}
                    disabled={isDeletePending}
                    className={`flex min-h-11 min-w-0 items-center gap-2 rounded-2xl border px-3 py-2 text-left text-sm font-medium transition ${selected ? "border-rose-300 bg-rose-50 text-rose-800 shadow-sm" : "border-slate-200 bg-white text-slate-700 hover:border-rose-200 hover:bg-rose-50/50"}`}
                  >
                    <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${selected ? "border-rose-400 bg-rose-500 text-white" : "border-slate-300 bg-white"}`}>
                      {selected ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
                    </span>
                    <span className="truncate">#{tag}</span>
                  </button>
                );
              })}
            </div>

            <p className="mt-4 rounded-xl bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-800">
              ここで削除されるのは入力時の保存候補だけです。すでに登録した思い出記録のタグは残ります。
            </p>
            {deleteError ? (
              <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                <p>{deleteError.message}</p>
                {deleteError.errorId ? <p className="mt-1 break-all text-xs">エラーID: {deleteError.errorId}</p> : null}
              </div>
            ) : null}
          </div>

          <div className="flex gap-3 border-t border-slate-100 bg-slate-50/80 px-5 py-4 sm:justify-end sm:px-7">
            <button type="button" onClick={() => setIsDeleteDialogOpen(false)} disabled={isDeletePending} className="button-secondary flex-1 sm:flex-none">キャンセル</button>
            <button type="button" onClick={deleteSelectedTags} disabled={selectedTags.length === 0 || isDeletePending} className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none">
              <Trash2 className="h-4 w-4" aria-hidden />
              {isDeletePending ? "削除中..." : `${selectedTags.length}件を削除`}
            </button>
          </div>
        </section>
      </div>,
      document.body
    )
    : null;

  return (
    <div className="grid gap-3">
      <label className="grid gap-1 text-sm font-medium text-slate-700">
        タグ（「、」またはカンマ区切り・最大20件）
        <input
          ref={inputRef}
          name="tags"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          maxLength={619}
          placeholder={tagSuggestions.slice(0, 4).join("、")}
        />
      </label>
      {reusableTags.length > 0 ? (
        <details className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-slate-700 select-none">保存済みタグ（{reusableTags.length}件）</summary>
          <div className="mt-3">
            <div className="flex flex-wrap gap-2">{tagButtons(reusableTags)}</div>
            <button
              type="button"
              onClick={openDeleteDialog}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              保存済みタグを削除
            </button>
          </div>
        </details>
      ) : null}
      {deleteSuccess ? <AutoDismissSuccessMessage key={deleteSuccess.key} message={deleteSuccess.message} /> : null}
      {initialSuggestions.length > 0 ? (
        <div className="grid gap-2">
          <span className="text-xs font-medium text-slate-600">候補</span>
          <div className="flex flex-wrap gap-2">{tagButtons(initialSuggestions)}</div>
        </div>
      ) : null}
      <label className="flex items-start gap-2 text-sm font-medium text-slate-700">
        <input type="checkbox" name="saveTags" value="true" className="mt-0.5" />
        <span>入力したタグを保存して再利用する<span className="mt-0.5 block text-xs font-normal text-slate-500">思い出の保存と同時に、区切られたタグを1件ずつ保存します。</span></span>
      </label>
      {deleteDialog}
    </div>
  );
}
