"use client";

import { ArrowDown, ArrowUp, GripVertical, LayoutDashboard, Save, Search } from "lucide-react";
import type { ChangeEvent, DragEvent } from "react";
import { useActionState, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { saveSettings } from "@/app/actions/settings";
import { DirtySubmitButton } from "@/components/dirty-submit-button";
import {
  commitFormDirtyState,
  requestFormDirtyReevaluation
} from "@/components/form-dirty-state";
import { ProfileSettingsFields } from "@/components/profile-settings-form";
import {
  SETTINGS_CARD_SCROLL_BUTTON_SAFE_PADDING,
  SETTINGS_CARD_SCROLL_SAFE_CONTENT_EXPAND
} from "@/components/settings-layout";
import { SettingsScrollToSaveButton } from "@/components/settings-scroll-to-save-button";
import { StatusMessage } from "@/components/status-message";
import { UnsavedChangesGuard } from "@/components/unsaved-changes-guard";
import {
  MAX_DASHBOARD_BOARD_COUNT,
  MIN_DASHBOARD_BOARD_COUNT,
  getDashboardPetRemovalPosition,
  getDashboardDropPosition,
  moveDashboardPetId,
  resizeDashboardPetIds,
  toggleDashboardPetId,
  type DashboardDropPosition,
  type DashboardPetRemovalPosition
} from "@/lib/dashboard-settings";
import { normalizeSearchText } from "@/lib/search";
import { getDashboardOrderScrollTop } from "@/lib/dashboard-order-scroll";
import {
  INITIAL_SETTINGS_SAVE_STATE,
  isCommittedSettingsSave
} from "@/lib/settings-save-state";

type PetOption = {
  id: string;
  name: string;
  species: "DOG" | "CAT";
  memo: string | null;
  isActive: boolean;
};

type DashboardSettingsFormProps = {
  name?: string | null;
  email?: string | null;
  boardCount: number;
  pets: PetOption[];
  selectedPetIds: string[];
};

type PetStatusFilter = "all" | "active" | "inactive" | "selected";
type MoveDirection = "up" | "down";
type RecentMove = {
  petId: string;
  direction: MoveDirection;
};
type DropTarget = {
  petId: string;
  position: DashboardDropPosition;
};
type PendingScrollRequest = {
  petId: string;
  sequence: number;
};

const PET_STATUS_FILTERS: { value: PetStatusFilter; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "active", label: "管理中" },
  { value: "inactive", label: "管理終了" },
  { value: "selected", label: "選択済み" }
];
const MOVE_FEEDBACK_DURATION_MS = 800;
const MOVE_ANIMATION_DURATION_MS = 240;
const SPECIES_LABELS = { DOG: "犬", CAT: "猫" } as const;

function clampBoardCount(value: number) {
  return Math.min(MAX_DASHBOARD_BOARD_COUNT, Math.max(MIN_DASHBOARD_BOARD_COUNT, Math.trunc(value)));
}

export function DashboardSettingsForm({
  name,
  email,
  boardCount,
  pets,
  selectedPetIds
}: DashboardSettingsFormProps) {
  const [limit, setLimit] = useState(boardCount);
  const [selectedIds, setSelectedIds] = useState(selectedPetIds);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<PetStatusFilter>("all");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [recentMove, setRecentMove] = useState<RecentMove | null>(null);
  const [orderAnnouncement, setOrderAnnouncement] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const [saveState, saveAction, isSaving] = useActionState(saveSettings, INITIAL_SETTINGS_SAVE_STATE);
  const orderListRef = useRef<HTMLOListElement>(null);
  const pendingOrderPositionsRef = useRef<Map<string, number> | null>(null);
  const removedSelectionPositionsRef = useRef<Map<string, DashboardPetRemovalPosition>>(new Map());
  const pendingSelectionDirtyReevaluationRef = useRef(false);
  const pendingScrollRequestRef = useRef<PendingScrollRequest | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const scrollRequestSequenceRef = useRef(0);
  const feedbackTimerRef = useRef<number | null>(null);
  const feedbackSequenceRef = useRef(0);
  const dragPreviewRef = useRef<HTMLElement | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);
  const petIds = useMemo(() => pets.map((pet) => pet.id), [pets]);
  const petById = useMemo(() => new Map(pets.map((pet) => [pet.id, pet])), [pets]);
  const needsSelection = pets.length > limit;
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const orderedPets = useMemo(
    () =>
      selectedIds
        .map((id) => petById.get(id))
        .filter((pet): pet is PetOption => Boolean(pet)),
    [petById, selectedIds]
  );
  const filteredPets = useMemo(() => {
    const normalizedSearchTerm = normalizeSearchText(searchTerm);

    return pets.filter((pet) => {
      const matchesSearch = normalizeSearchText(pet.name).includes(normalizedSearchTerm);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && pet.isActive) ||
        (statusFilter === "inactive" && !pet.isActive) ||
        (statusFilter === "selected" && selectedIdSet.has(pet.id));

      return matchesSearch && matchesStatus;
    });
  }, [pets, searchTerm, selectedIdSet, statusFilter]);
  const targetCount = Math.min(limit, pets.length);
  const canSave = selectedIds.length === targetCount;
  const selectionBasisKey = JSON.stringify([boardCount, petIds, selectedPetIds]);

  useEffect(() => {
    removedSelectionPositionsRef.current.clear();
  }, [selectionBasisKey]);

  useEffect(() => {
    if (saveState.submissionId === 0) {
      return;
    }

    const form = formRef.current;
    if (!isCommittedSettingsSave(saveState)) {
      requestFormDirtyReevaluation(form);
      return;
    }

    window.requestAnimationFrame(() => {
      const savedSettings = saveState.savedDashboardSettings;
      if (savedSettings) {
        removedSelectionPositionsRef.current.clear();
        pendingSelectionDirtyReevaluationRef.current = false;
        setLimit(savedSettings.dashboardBoardCount);
        setSelectedIds(savedSettings.petIds);
      }

      const nameControl = form?.elements.namedItem("name");
      if (nameControl instanceof HTMLInputElement && saveState.savedName !== undefined) {
        nameControl.value = saveState.savedName;
        nameControl.defaultValue = saveState.savedName;
      }

      if (form && savedSettings) {
        const boardCountControl = form.elements.namedItem("dashboardBoardCount");
        if (boardCountControl instanceof HTMLInputElement) {
          boardCountControl.value = String(savedSettings.dashboardBoardCount);
          boardCountControl.defaultValue = boardCountControl.value;
        }
      }

      window.requestAnimationFrame(() => commitFormDirtyState(form));
    });
  }, [saveState]);

  useLayoutEffect(() => {
    if (pendingSelectionDirtyReevaluationRef.current) {
      pendingSelectionDirtyReevaluationRef.current = false;
      requestFormDirtyReevaluation(formRef.current);
    }

    const previousPositions = pendingOrderPositionsRef.current;
    const pendingScrollRequest = pendingScrollRequestRef.current;
    pendingOrderPositionsRef.current = null;
    pendingScrollRequestRef.current = null;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // 並べ替え前後の座標差から移動を描画する。DOM順は先に確定しているため、保存値や読み上げ順には影響しない。
    if (previousPositions && !reducedMotion) {
      orderListRef.current?.querySelectorAll<HTMLElement>("[data-dashboard-pet-order-id]").forEach((row) => {
        const petId = row.dataset.dashboardPetOrderId;
        const previousTop = petId ? previousPositions.get(petId) : undefined;

        if (previousTop === undefined) {
          return;
        }

        const offsetY = previousTop - row.getBoundingClientRect().top;
        if (offsetY === 0) {
          return;
        }

        row.animate(
          [{ transform: `translateY(${offsetY}px)` }, { transform: "translateY(0)" }],
          {
            duration: MOVE_ANIMATION_DURATION_MS,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)"
          }
        );
      });
    }

    const orderList = orderListRef.current;
    if (
      !pendingScrollRequest ||
      !orderList ||
      !window.matchMedia("(max-width: 639px)").matches ||
      orderList.scrollHeight <= orderList.clientHeight
    ) {
      return;
    }

    const movedRow = Array.from(
      orderList.querySelectorAll<HTMLElement>("[data-dashboard-pet-order-id]")
    ).find((row) => row.dataset.dashboardPetOrderId === pendingScrollRequest.petId);
    if (!movedRow) {
      return;
    }

    const scheduleScroll = () => {
      if (pendingScrollRequest.sequence !== scrollRequestSequenceRef.current) {
        return;
      }

      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
      scrollFrameRef.current = window.requestAnimationFrame(() => {
        if (pendingScrollRequest.sequence !== scrollRequestSequenceRef.current) {
          scrollFrameRef.current = null;
          return;
        }

        const rowLayoutTop = movedRow.offsetTop - orderList.offsetTop;
        const nextScrollTop = getDashboardOrderScrollTop({
          currentScrollTop: orderList.scrollTop,
          maxScrollTop: orderList.scrollHeight - orderList.clientHeight,
          listTop: orderList.scrollTop,
          listBottom: orderList.scrollTop + orderList.clientHeight,
          rowTop: rowLayoutTop,
          rowBottom: rowLayoutTop + movedRow.offsetHeight
        });

        if (nextScrollTop !== orderList.scrollTop) {
          orderList.scrollTo({ top: nextScrollTop, behavior: reducedMotion ? "auto" : "smooth" });
        }
        scrollFrameRef.current = null;
      });
    };

    scheduleScroll();
  }, [selectedIds]);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
      }
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
      dragPreviewRef.current?.remove();
      dragPreviewRef.current = null;
    };
  }, []);

  function handleLimitChange(event: ChangeEvent<HTMLInputElement>) {
    const nextLimit = clampBoardCount(event.currentTarget.valueAsNumber || MIN_DASHBOARD_BOARD_COUNT);

    // 表示数を減らした場合は、保存可能な件数に収まるよう現在の選択を先頭から残す。
    removedSelectionPositionsRef.current.clear();
    pendingSelectionDirtyReevaluationRef.current = true;
    setLimit(nextLimit);
    setSelectedIds(resizeDashboardPetIds(petIds, selectedIds, nextLimit));
  }

  function handleToggle(petId: string) {
    if (!needsSelection) {
      return;
    }

    const isSelected = selectedIds.includes(petId);
    const restorePosition = removedSelectionPositionsRef.current.get(petId);
    const nextIds = toggleDashboardPetId(selectedIds, petId, limit, restorePosition);

    if (isSelected) {
      const removalPosition = getDashboardPetRemovalPosition(selectedIds, petId);
      if (removalPosition) {
        removedSelectionPositionsRef.current.set(petId, removalPosition);
      }
    } else if (nextIds.includes(petId)) {
      removedSelectionPositionsRef.current.delete(petId);
    }

    pendingSelectionDirtyReevaluationRef.current = true;
    setSelectedIds(nextIds);
  }

  function updateOrder(
    petId: string,
    targetPetId: string,
    position: DashboardDropPosition
  ) {
    const nextIds = moveDashboardPetId(selectedIds, petId, targetPetId, position);
    const nextIndex = nextIds.indexOf(petId);
    const pet = petById.get(petId);

    if (nextIndex < 0 || !nextIds.some((id, index) => id !== selectedIds[index])) {
      return false;
    }

    setSelectedIds(nextIds);
    setOrderAnnouncement(`${pet?.name ?? "Pet"}を${nextIndex + 1}番目へ移動しました。`);
    requestFormDirtyReevaluation(formRef.current);
    return true;
  }

  function captureOrderPositions() {
    const positions = new Map<string, number>();

    orderListRef.current?.querySelectorAll<HTMLElement>("[data-dashboard-pet-order-id]").forEach((row) => {
      const petId = row.dataset.dashboardPetOrderId;
      if (petId) {
        positions.set(petId, row.getBoundingClientRect().top);
      }
      row.getAnimations().forEach((animation) => animation.cancel());
    });

    return positions;
  }

  function startMoveFeedback(petId: string, direction: MoveDirection) {
    const feedbackSequence = feedbackSequenceRef.current + 1;
    feedbackSequenceRef.current = feedbackSequence;

    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
    }

    setRecentMove({ petId, direction });
    feedbackTimerRef.current = window.setTimeout(() => {
      if (feedbackSequenceRef.current === feedbackSequence) {
        setRecentMove(null);
        feedbackTimerRef.current = null;
      }
    }, MOVE_FEEDBACK_DURATION_MS);
  }

  function clearMoveFeedback() {
    feedbackSequenceRef.current += 1;
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
    setRecentMove(null);
  }

  function updateDropTarget(nextTarget: DropTarget | null) {
    const currentTarget = dropTargetRef.current;

    if (
      currentTarget?.petId === nextTarget?.petId &&
      currentTarget?.position === nextTarget?.position
    ) {
      return;
    }

    dropTargetRef.current = nextTarget;
    setDropTarget(nextTarget);
  }

  function moveByOffset(petId: string, direction: MoveDirection) {
    const currentIndex = selectedIds.indexOf(petId);
    const offset = direction === "up" ? -1 : 1;
    const targetId = selectedIds[currentIndex + offset];
    if (!targetId) {
      return;
    }

    pendingOrderPositionsRef.current = captureOrderPositions();
    const scrollRequestSequence = scrollRequestSequenceRef.current + 1;
    pendingScrollRequestRef.current = { petId, sequence: scrollRequestSequence };
    const position = direction === "up" ? "before" : "after";
    if (updateOrder(petId, targetId, position)) {
      scrollRequestSequenceRef.current = scrollRequestSequence;
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
      const orderList = orderListRef.current;
      if (orderList && window.matchMedia("(max-width: 639px)").matches) {
        orderList.scrollTo({ top: orderList.scrollTop, behavior: "auto" });
      }
      startMoveFeedback(petId, direction);
    } else {
      pendingOrderPositionsRef.current = null;
      pendingScrollRequestRef.current = null;
    }
  }

  function removeDragPreview() {
    dragPreviewRef.current?.remove();
    dragPreviewRef.current = null;
  }

  function createDragPreview(event: DragEvent<HTMLButtonElement>) {
    removeDragPreview();
    const row = event.currentTarget.closest<HTMLElement>("[data-dashboard-pet-order-id]");
    if (!row) {
      return;
    }

    const preview = row.cloneNode(true) as HTMLElement;
    preview.setAttribute("aria-hidden", "true");
    preview.style.position = "fixed";
    preview.style.left = "-10000px";
    preview.style.top = "-10000px";
    preview.style.width = `${row.getBoundingClientRect().width}px`;
    preview.style.opacity = "0.8";
    preview.style.pointerEvents = "none";
    preview.style.zIndex = "-1";
    preview.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], [tabindex]").forEach((element) => {
      element.tabIndex = -1;
    });
    document.body.appendChild(preview);
    dragPreviewRef.current = preview;
    event.dataTransfer.setDragImage(preview, 24, 24);
  }

  function handleDragStart(event: DragEvent<HTMLButtonElement>, petId: string) {
    pendingOrderPositionsRef.current = null;
    orderListRef.current
      ?.querySelectorAll<HTMLElement>("[data-dashboard-pet-order-id]")
      .forEach((row) => row.getAnimations().forEach((animation) => animation.cancel()));
    clearMoveFeedback();
    updateDropTarget(null);
    createDragPreview(event);
    setDraggedId(petId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", petId);
  }

  function handleDragOver(event: DragEvent<HTMLLIElement>, petId: string) {
    if (!draggedId || draggedId === petId) {
      updateDropTarget(null);
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const position = getDashboardDropPosition(event.clientY, event.currentTarget.getBoundingClientRect());
    updateDropTarget({ petId, position });
  }

  function handleOrderListDragOver(event: DragEvent<HTMLOListElement>) {
    if (!draggedId || !dropTargetRef.current) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function handleOrderListDragLeave(event: DragEvent<HTMLOListElement>) {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const isOutside =
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom;

    if (isOutside) {
      updateDropTarget(null);
    }
  }

  function clearDragState() {
    setDraggedId(null);
    updateDropTarget(null);
    removeDragPreview();
  }

  function handleOrderListDrop(event: DragEvent<HTMLOListElement>) {
    event.preventDefault();
    const petId = draggedId ?? event.dataTransfer.getData("text/plain");
    const currentDropTarget = dropTargetRef.current;

    if (petId && currentDropTarget && petId !== currentDropTarget.petId) {
      updateOrder(petId, currentDropTarget.petId, currentDropTarget.position);
    }

    clearDragState();
  }

  function handleDragEnd() {
    clearDragState();
  }

  return (
    <UnsavedChangesGuard>
      <SettingsScrollToSaveButton />

      <form
        ref={formRef}
        action={saveAction}
        data-dirty-watch
        aria-busy={isSaving}
        className="space-y-6"
      >
        <ProfileSettingsFields name={name} email={email} />

        <section
          aria-labelledby="dashboard-settings-heading"
          data-settings-section="dashboard"
          className={`rounded-md border border-slate-200 bg-white shadow-sm ${SETTINGS_CARD_SCROLL_BUTTON_SAFE_PADDING}`}
        >
          <div className={`space-y-5 ${SETTINGS_CARD_SCROLL_SAFE_CONTENT_EXPAND}`}>
          <header className="space-y-1">
            <div className="flex items-center gap-2">
              <LayoutDashboard className="h-5 w-5 text-brand" aria-hidden />
              <h3 id="dashboard-settings-heading" className="text-base font-bold text-ink">
                ダッシュボード設定
              </h3>
            </div>
            <p className="text-sm leading-6 text-slate-600">
              ダッシュボードに表示する件数、カードの並び順とPetを設定します。
            </p>
          </header>

          <div className="grid gap-4 md:grid-cols-[220px_1fr]" data-dashboard-board-count>
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              表示ボード数
              <input
                type="number"
                name="dashboardBoardCount"
                min={MIN_DASHBOARD_BOARD_COUNT}
                max={MAX_DASHBOARD_BOARD_COUNT}
                value={limit}
                onChange={handleLimitChange}
                required
              />
              <span className="text-xs font-normal text-slate-500">
                設定できる範囲: {MIN_DASHBOARD_BOARD_COUNT}〜{MAX_DASHBOARD_BOARD_COUNT} 件
              </span>
            </label>
            <div className="rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-600">
              現在の表示対象: {selectedIds.length} / {targetCount} 件
              <span className="block pt-1">
                表示ボード数の上限は {MAX_DASHBOARD_BOARD_COUNT} 件です。
              </span>
              {needsSelection ? (
                <span className="block pt-1">表示するPetを {targetCount} 件選択します。</span>
              ) : (
                <span className="block pt-1">
                  登録数が表示数以下のため、全Petを表示します。
                </span>
              )}
              {!canSave ? (
                <span className="block pt-1 text-red-600">
                  表示対象を {targetCount} 件選択してください。
                </span>
              ) : null}
            </div>
          </div>

          <section
            className="space-y-3 border-t border-slate-200 pt-5"
            aria-labelledby="dashboard-pet-order-heading"
            data-dashboard-pet-order
          >
            <div className="space-y-1">
              <div className="flex items-start justify-between gap-3">
                <h4 id="dashboard-pet-order-heading" className="text-base font-bold text-ink">
                  ダッシュボードカードの並び順
                </h4>
                <span className="shrink-0 whitespace-nowrap text-xs font-medium tabular-nums text-slate-500 sm:hidden">
                  全{orderedPets.length}件
                </span>
              </div>
              <p id="dashboard-pet-order-help" className="text-xs leading-5 text-slate-500">
                PCではドラッグハンドルまたは上下ボタンで並び替えられます。スマートフォンでは上下ボタンを使用してください。
              </p>
            </div>

            {orderedPets.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">
                表示対象のPetはいません。
              </div>
            ) : (
              <ol
                ref={orderListRef}
                className="flex max-h-[var(--dashboard-order-max-height)] flex-col gap-2 overflow-x-hidden overflow-y-auto overscroll-contain [--dashboard-order-max-height:min(55vh,28rem)] supports-[height:1dvh]:[--dashboard-order-max-height:min(55dvh,28rem)] sm:max-h-none sm:overflow-visible sm:overscroll-auto"
                aria-describedby="dashboard-pet-order-help"
                onDragOver={handleOrderListDragOver}
                onDragLeave={handleOrderListDragLeave}
                onDrop={handleOrderListDrop}
              >
                {orderedPets.map((pet, index) => {
                  const isDropTarget = dropTarget?.petId === pet.id;
                  const isDropBefore = isDropTarget && dropTarget.position === "before";
                  const isDropAfter = isDropTarget && dropTarget.position === "after";
                  const dropSpacingClass = isDropBefore ? "sm:mt-2" : isDropAfter ? "sm:mb-2" : "";
                  const beforeLinePositionClass = index === 0 ? "sm:-top-1.5" : "sm:-top-2.5";
                  const afterLinePositionClass =
                    index === orderedPets.length - 1 ? "sm:-bottom-1.5" : "sm:-bottom-2.5";
                  const isDragging = draggedId === pet.id;
                  const isRecentlyMoved = recentMove?.petId === pet.id;
                  const rowStateClass = isDropTarget
                    ? "border-brand bg-brand/10 ring-2 ring-brand/20"
                    : isRecentlyMoved
                      ? "border-brand/70 bg-brand/10"
                      : "border-slate-200 bg-white sm:hover:border-slate-300 sm:hover:bg-slate-50";

                  return (
                    <li
                      key={pet.id}
                      data-dashboard-pet-order-id={pet.id}
                      onDragOver={(event) => handleDragOver(event, pet.id)}
                      data-drop-target={isDropTarget ? "true" : undefined}
                      data-drop-position={isDropTarget ? dropTarget.position : undefined}
                      data-dragging={isDragging ? "true" : undefined}
                      data-recently-moved={isRecentlyMoved ? "true" : undefined}
                      className={`relative grid min-w-0 shrink-0 grid-cols-[2.75rem_minmax(0,1fr)] items-stretch gap-0 overflow-hidden rounded-md border p-0 transition-[margin,background-color,border-color,opacity] duration-150 ease-out motion-reduce:transition-none sm:flex sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:overflow-visible sm:p-3 ${rowStateClass} ${dropSpacingClass} ${
                        isDragging ? "opacity-50" : "opacity-100"
                      }`}
                    >
                      {isDropBefore ? (
                        <span
                          aria-hidden="true"
                          data-drop-indicator="before"
                          className={`pointer-events-none absolute -top-1.5 left-2 right-2 z-10 h-1 rounded-full bg-brand shadow-sm ${beforeLinePositionClass}`}
                        />
                      ) : null}
                      {isDropAfter ? (
                        <span
                          aria-hidden="true"
                          data-drop-indicator="after"
                          className={`pointer-events-none absolute -bottom-1.5 left-2 right-2 z-10 h-1 rounded-full bg-brand shadow-sm ${afterLinePositionClass}`}
                        />
                      ) : null}
                      <span
                        data-dashboard-pet-rank
                        aria-label={`${index + 1}番目`}
                        className="flex min-w-0 items-center justify-center border-r border-slate-200 px-1 text-sm font-bold tabular-nums text-slate-600 sm:hidden"
                      >
                        {index + 1}
                      </span>
                      <div
                        data-dashboard-pet-row-content
                        className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 p-2 sm:contents"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <button
                            type="button"
                            draggable
                            onDragStart={(event) => handleDragStart(event, pet.id)}
                            onDragEnd={handleDragEnd}
                            aria-label={`${pet.name}をドラッグして並び替え`}
                            aria-roledescription="並び替えハンドル"
                            className="hidden h-11 w-11 shrink-0 cursor-grab items-center justify-center rounded-md border border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 sm:inline-flex"
                          >
                            <GripVertical className="h-5 w-5" aria-hidden />
                          </button>
                          <span className="min-w-0">
                            <span className="block break-words text-sm font-semibold text-ink">
                              {pet.name}
                            </span>
                            <span className="mt-1 block text-xs text-slate-500">
                              {SPECIES_LABELS[pet.species]}
                            </span>
                            <span
                              className={`mt-1 inline-flex shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold ${
                                pet.isActive
                                  ? "bg-highlight/40 text-slate-700"
                                  : "bg-slate-200 text-slate-600"
                              }`}
                            >
                              {pet.isActive ? "管理中" : "管理終了"}
                            </span>
                          </span>
                        </div>

                        <div className="grid shrink-0 grid-cols-2 gap-2" aria-label={`${pet.name}の並び替え操作`}>
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => moveByOffset(pet.id, "up")}
                            aria-label={`${pet.name}を上へ移動`}
                            data-move-feedback={isRecentlyMoved && recentMove.direction === "up" ? "true" : undefined}
                            className={`inline-flex h-11 w-11 items-center justify-center rounded-md border transition-colors duration-200 motion-reduce:transition-none disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${
                              isRecentlyMoved && recentMove.direction === "up"
                                ? "border-brand bg-brand/[0.15] text-brand hover:bg-brand/20 disabled:border-brand disabled:bg-brand/[0.15] disabled:text-brand disabled:opacity-70"
                                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:bg-slate-100 disabled:text-slate-400"
                            }`}
                          >
                            <ArrowUp className="h-4 w-4" aria-hidden />
                          </button>
                          <button
                            type="button"
                            disabled={index === orderedPets.length - 1}
                            onClick={() => moveByOffset(pet.id, "down")}
                            aria-label={`${pet.name}を下へ移動`}
                            data-move-feedback={isRecentlyMoved && recentMove.direction === "down" ? "true" : undefined}
                            className={`inline-flex h-11 w-11 items-center justify-center rounded-md border transition-colors duration-200 motion-reduce:transition-none disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${
                              isRecentlyMoved && recentMove.direction === "down"
                                ? "border-brand bg-brand/[0.15] text-brand hover:bg-brand/20 disabled:border-brand disabled:bg-brand/[0.15] disabled:text-brand disabled:opacity-70"
                                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:bg-slate-100 disabled:text-slate-400"
                            }`}
                          >
                            <ArrowDown className="h-4 w-4" aria-hidden />
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
            <p className="sr-only" aria-live="polite" aria-atomic="true">
              {orderAnnouncement}
            </p>
          </section>

          {/* disabled の checkbox は送信されないため、保存対象Pet IDは hidden input に正規化して渡す。 */}
          {selectedIds.map((id) => (
            <input key={id} type="hidden" name="petIds" value={id} data-dirty-control />
          ))}

          <section
            className="space-y-3 border-t border-slate-200 pt-5"
            aria-labelledby="dashboard-pet-selection-heading"
            data-dashboard-pet-selection
          >
            <h4 id="dashboard-pet-selection-heading" className="text-base font-bold text-ink">
              ダッシュボードに表示するPet
            </h4>
        {pets.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            Petがまだ登録されていません。
          </div>
        ) : (
          <>
            <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4">
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                検索ワード
                <span className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                  <input
                    type="search"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.currentTarget.value)}
                    className="pl-9"
                    placeholder="Pet名で検索"
                  />
                </span>
              </label>
              <div className="space-y-1.5">
                <span className="block text-sm font-medium text-slate-700">状態</span>
                <div
                  className="grid grid-cols-4 rounded-xl bg-slate-100 p-1 sm:flex sm:flex-wrap sm:gap-2 sm:rounded-none sm:bg-transparent sm:p-0"
                  aria-label="Petの状態で絞り込む"
                >
                  {PET_STATUS_FILTERS.map((filter) => {
                    const isSelected = statusFilter === filter.value;

                    return (
                      <button
                        key={filter.value}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setStatusFilter(filter.value)}
                        className={`flex min-h-11 min-w-0 items-center justify-center whitespace-nowrap rounded-lg px-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 sm:min-h-0 sm:rounded-md sm:border sm:px-3 sm:py-1.5 sm:text-sm sm:font-semibold ${
                          isSelected
                            ? "bg-brand/10 text-brand ring-1 ring-inset ring-brand/20 sm:border-brand sm:bg-brand sm:text-white sm:ring-0"
                            : "text-slate-600 hover:bg-white/70 hover:text-ink sm:border-slate-300 sm:bg-white sm:text-slate-700 sm:hover:border-slate-400 sm:hover:bg-slate-100"
                        }`}
                      >
                        {filter.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-500">
              {pets.length} 件中 {filteredPets.length} 件が条件に一致しています。
            </p>

            {filteredPets.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                {statusFilter === "selected"
                  ? "選択中のPetはいません。"
                  : "条件に一致するPetはいません。"}
              </div>
            ) : (
              <div className="max-h-[50vh] divide-y divide-slate-200 overflow-y-auto rounded-md border border-slate-200 sm:max-h-96 lg:max-h-[28rem]">
                {filteredPets.map((pet) => {
                  const checked = selectedIdSet.has(pet.id);
                  // 上限に達した後は未選択の行だけを無効化し、選択済みの解除はできるようにする。
                  const disabled = !checked && needsSelection && selectedIds.length >= limit;

                  return (
                    <label
                      key={pet.id}
                      className={`flex items-start gap-3 px-4 py-3 text-sm ${
                        disabled ? "cursor-not-allowed bg-slate-50 text-slate-400" : "cursor-pointer text-slate-700"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!needsSelection || disabled}
                        onChange={() => handleToggle(pet.id)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                          {pet.name}
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                            {SPECIES_LABELS[pet.species]}
                          </span>
                          <span
                            className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                              pet.isActive
                                ? "bg-highlight/40 text-slate-700"
                                : "bg-slate-200 text-slate-600"
                            }`}
                          >
                            {pet.isActive ? "管理中" : "管理終了"}
                          </span>
                        </span>
                        {pet.memo ? <span className="mt-1 block truncate text-slate-500">{pet.memo}</span> : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </>
        )}
          </section>
          </div>
        </section>

        <div id="dashboard-settings-save" className="scroll-mt-24">
          {saveState.status ? (
            <div
              key={saveState.submissionId}
              data-settings-save-toast
              className="fixed inset-x-4 bottom-20 z-50 sm:left-auto sm:right-5 sm:w-full sm:max-w-md"
            >
              <StatusMessage status={saveState.status} errorId={saveState.errorId} />
            </div>
          ) : null}
          <div className="flex justify-end">
            <DirtySubmitButton
              disabled={!canSave || isSaving}
              className="inline-flex items-center gap-2 rounded-md bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Save className="h-4 w-4" aria-hidden />
              {isSaving ? "保存中…" : "保存"}
            </DirtySubmitButton>
          </div>
        </div>
      </form>
    </UnsavedChangesGuard>
  );
}
