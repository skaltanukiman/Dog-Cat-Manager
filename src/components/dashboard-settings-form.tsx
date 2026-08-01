"use client";

import { ArrowDown, ArrowUp, GripVertical, LayoutDashboard, Save, Search } from "lucide-react";
import type { ChangeEvent, DragEvent } from "react";
import { useActionState, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { saveSettings } from "@/app/actions/settings";
import { DisplaySettingsSection } from "@/components/display-settings-section";
import { DirtySubmitButton } from "@/components/dirty-submit-button";
import {
  commitFormDirtyState,
  requestFormDirtyReevaluation
} from "@/components/form-dirty-state";
import { ProfileSettingsFields } from "@/components/profile-settings-form";
import { SETTINGS_CARD_RESPONSIVE_PADDING } from "@/components/settings-layout";
import { SettingsScrollToSaveButton } from "@/components/settings-scroll-to-save-button";
import { StatusMessage } from "@/components/status-message";
import { UnsavedChangesGuard } from "@/components/unsaved-changes-guard";
import type { CleaningMobileDefaultDateFilter } from "@/lib/cleaning-settings";
import {
  MAX_DASHBOARD_BOARD_COUNT,
  MIN_DASHBOARD_BOARD_COUNT,
  getDashboardDropPosition,
  moveDashboardHamsterId,
  resizeDashboardHamsterIds,
  toggleDashboardHamsterId,
  type DashboardDropPosition,
  type HamsterSelectorMode
} from "@/lib/dashboard-settings";
import type { RecordScope } from "@/lib/records";
import { normalizeSearchText } from "@/lib/search";
import { getDashboardOrderScrollTop } from "@/lib/dashboard-order-scroll";
import {
  INITIAL_SETTINGS_SAVE_STATE,
  isCommittedSettingsSave
} from "@/lib/settings-save-state";

type HamsterOption = {
  id: string;
  name: string;
  memo: string | null;
  isActive: boolean;
};

type DashboardSettingsFormProps = {
  name?: string | null;
  email?: string | null;
  boardCount: number;
  hamsterSelectorMode: HamsterSelectorMode;
  recordTimelineDefaultScope: RecordScope;
  cleaningMobileDefaultDateFilter: CleaningMobileDefaultDateFilter;
  hamsters: HamsterOption[];
  selectedHamsterIds: string[];
};

type HamsterStatusFilter = "all" | "active" | "inactive" | "selected";
type MoveDirection = "up" | "down";
type RecentMove = {
  hamsterId: string;
  direction: MoveDirection;
};
type DropTarget = {
  hamsterId: string;
  position: DashboardDropPosition;
};
type PendingScrollRequest = {
  hamsterId: string;
  sequence: number;
};

const HAMSTER_STATUS_FILTERS: { value: HamsterStatusFilter; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "active", label: "管理中" },
  { value: "inactive", label: "管理外" },
  { value: "selected", label: "選択済み" }
];
const MOVE_FEEDBACK_DURATION_MS = 800;
const MOVE_ANIMATION_DURATION_MS = 240;

function clampBoardCount(value: number) {
  return Math.min(MAX_DASHBOARD_BOARD_COUNT, Math.max(MIN_DASHBOARD_BOARD_COUNT, Math.trunc(value)));
}

export function DashboardSettingsForm({
  name,
  email,
  boardCount,
  hamsterSelectorMode,
  recordTimelineDefaultScope,
  cleaningMobileDefaultDateFilter,
  hamsters,
  selectedHamsterIds
}: DashboardSettingsFormProps) {
  const [limit, setLimit] = useState(boardCount);
  const [selectedIds, setSelectedIds] = useState(selectedHamsterIds);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<HamsterStatusFilter>("all");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [recentMove, setRecentMove] = useState<RecentMove | null>(null);
  const [orderAnnouncement, setOrderAnnouncement] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const [saveState, saveAction, isSaving] = useActionState(saveSettings, INITIAL_SETTINGS_SAVE_STATE);
  const orderListRef = useRef<HTMLOListElement>(null);
  const pendingOrderPositionsRef = useRef<Map<string, number> | null>(null);
  const pendingScrollRequestRef = useRef<PendingScrollRequest | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const scrollRequestSequenceRef = useRef(0);
  const feedbackTimerRef = useRef<number | null>(null);
  const feedbackSequenceRef = useRef(0);
  const dragPreviewRef = useRef<HTMLElement | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);
  const hamsterIds = useMemo(() => hamsters.map((hamster) => hamster.id), [hamsters]);
  const hamsterById = useMemo(() => new Map(hamsters.map((hamster) => [hamster.id, hamster])), [hamsters]);
  const needsSelection = hamsters.length > limit;
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const orderedHamsters = useMemo(
    () =>
      selectedIds
        .map((id) => hamsterById.get(id))
        .filter((hamster): hamster is HamsterOption => Boolean(hamster)),
    [hamsterById, selectedIds]
  );
  const filteredHamsters = useMemo(() => {
    const normalizedSearchTerm = normalizeSearchText(searchTerm);

    return hamsters.filter((hamster) => {
      const matchesSearch = normalizeSearchText(hamster.name).includes(normalizedSearchTerm);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && hamster.isActive) ||
        (statusFilter === "inactive" && !hamster.isActive) ||
        (statusFilter === "selected" && selectedIdSet.has(hamster.id));

      return matchesSearch && matchesStatus;
    });
  }, [hamsters, searchTerm, selectedIdSet, statusFilter]);
  const targetCount = Math.min(limit, hamsters.length);
  const canSave = selectedIds.length === targetCount;

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
        setLimit(savedSettings.dashboardBoardCount);
        setSelectedIds(savedSettings.hamsterIds);
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
        for (const name of [
          "hamsterSelectorMode",
          "recordTimelineDefaultScope",
          "cleaningMobileDefaultDateFilter"
        ]) {
          const controls = form.elements.namedItem(name);
          const radios = controls instanceof RadioNodeList ? Array.from(controls) : [controls];
          for (const control of radios) {
            if (control instanceof HTMLInputElement) {
              const savedValue = savedSettings[name as keyof typeof savedSettings];
              control.checked = control.value === savedValue;
              control.defaultChecked = control.checked;
            }
          }
        }
      }

      window.requestAnimationFrame(() => commitFormDirtyState(form));
    });
  }, [saveState]);

  useLayoutEffect(() => {
    const previousPositions = pendingOrderPositionsRef.current;
    const pendingScrollRequest = pendingScrollRequestRef.current;
    pendingOrderPositionsRef.current = null;
    pendingScrollRequestRef.current = null;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (previousPositions && !reducedMotion) {
      orderListRef.current?.querySelectorAll<HTMLElement>("[data-dashboard-hamster-order-id]").forEach((row) => {
        const hamsterId = row.dataset.dashboardHamsterOrderId;
        const previousTop = hamsterId ? previousPositions.get(hamsterId) : undefined;

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
      orderList.querySelectorAll<HTMLElement>("[data-dashboard-hamster-order-id]")
    ).find((row) => row.dataset.dashboardHamsterOrderId === pendingScrollRequest.hamsterId);
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
    setLimit(nextLimit);
    setSelectedIds(resizeDashboardHamsterIds(hamsterIds, selectedIds, nextLimit));
  }

  function handleToggle(hamsterId: string) {
    if (!needsSelection) {
      return;
    }

    setSelectedIds((current) => toggleDashboardHamsterId(current, hamsterId, limit));
  }

  function updateOrder(
    hamsterId: string,
    targetHamsterId: string,
    position: DashboardDropPosition
  ) {
    const nextIds = moveDashboardHamsterId(selectedIds, hamsterId, targetHamsterId, position);
    const nextIndex = nextIds.indexOf(hamsterId);
    const hamster = hamsterById.get(hamsterId);

    if (nextIndex < 0 || !nextIds.some((id, index) => id !== selectedIds[index])) {
      return false;
    }

    setSelectedIds(nextIds);
    setOrderAnnouncement(`${hamster?.name ?? "ハムスター"}を${nextIndex + 1}番目へ移動しました。`);
    requestFormDirtyReevaluation(formRef.current);
    return true;
  }

  function captureOrderPositions() {
    const positions = new Map<string, number>();

    orderListRef.current?.querySelectorAll<HTMLElement>("[data-dashboard-hamster-order-id]").forEach((row) => {
      const hamsterId = row.dataset.dashboardHamsterOrderId;
      if (hamsterId) {
        positions.set(hamsterId, row.getBoundingClientRect().top);
      }
      row.getAnimations().forEach((animation) => animation.cancel());
    });

    return positions;
  }

  function startMoveFeedback(hamsterId: string, direction: MoveDirection) {
    const feedbackSequence = feedbackSequenceRef.current + 1;
    feedbackSequenceRef.current = feedbackSequence;

    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
    }

    setRecentMove({ hamsterId, direction });
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
      currentTarget?.hamsterId === nextTarget?.hamsterId &&
      currentTarget?.position === nextTarget?.position
    ) {
      return;
    }

    dropTargetRef.current = nextTarget;
    setDropTarget(nextTarget);
  }

  function moveByOffset(hamsterId: string, direction: MoveDirection) {
    const currentIndex = selectedIds.indexOf(hamsterId);
    const offset = direction === "up" ? -1 : 1;
    const targetId = selectedIds[currentIndex + offset];
    if (!targetId) {
      return;
    }

    pendingOrderPositionsRef.current = captureOrderPositions();
    const scrollRequestSequence = scrollRequestSequenceRef.current + 1;
    pendingScrollRequestRef.current = { hamsterId, sequence: scrollRequestSequence };
    const position = direction === "up" ? "before" : "after";
    if (updateOrder(hamsterId, targetId, position)) {
      scrollRequestSequenceRef.current = scrollRequestSequence;
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
      const orderList = orderListRef.current;
      if (orderList && window.matchMedia("(max-width: 639px)").matches) {
        orderList.scrollTo({ top: orderList.scrollTop, behavior: "auto" });
      }
      startMoveFeedback(hamsterId, direction);
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
    const row = event.currentTarget.closest<HTMLElement>("[data-dashboard-hamster-order-id]");
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

  function handleDragStart(event: DragEvent<HTMLButtonElement>, hamsterId: string) {
    pendingOrderPositionsRef.current = null;
    orderListRef.current
      ?.querySelectorAll<HTMLElement>("[data-dashboard-hamster-order-id]")
      .forEach((row) => row.getAnimations().forEach((animation) => animation.cancel()));
    clearMoveFeedback();
    updateDropTarget(null);
    createDragPreview(event);
    setDraggedId(hamsterId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", hamsterId);
  }

  function handleDragOver(event: DragEvent<HTMLLIElement>, hamsterId: string) {
    if (!draggedId || draggedId === hamsterId) {
      updateDropTarget(null);
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const position = getDashboardDropPosition(event.clientY, event.currentTarget.getBoundingClientRect());
    updateDropTarget({ hamsterId, position });
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
    const hamsterId = draggedId ?? event.dataTransfer.getData("text/plain");
    const currentDropTarget = dropTargetRef.current;

    if (hamsterId && currentDropTarget && hamsterId !== currentDropTarget.hamsterId) {
      updateOrder(hamsterId, currentDropTarget.hamsterId, currentDropTarget.position);
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

        <DisplaySettingsSection
          hamsterSelectorMode={hamsterSelectorMode}
          recordTimelineDefaultScope={recordTimelineDefaultScope}
          cleaningMobileDefaultDateFilter={cleaningMobileDefaultDateFilter}
          savedSettings={saveState.savedDashboardSettings}
          savedSubmissionId={saveState.submissionId}
        />

        <section
          aria-labelledby="dashboard-settings-heading"
          data-settings-section="dashboard"
          className={`space-y-5 rounded-md border border-slate-200 bg-white shadow-sm ${SETTINGS_CARD_RESPONSIVE_PADDING}`}
        >
          <header className="space-y-1">
            <div className="flex items-center gap-2">
              <LayoutDashboard className="h-5 w-5 text-moss" aria-hidden />
              <h3 id="dashboard-settings-heading" className="text-base font-bold text-ink">
                ダッシュボード設定
              </h3>
            </div>
            <p className="text-sm leading-6 text-slate-600">
              ダッシュボードに表示する件数、カードの並び順とハムスターを設定します。
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
                <span className="block pt-1">表示するハムスターを {targetCount} 件選択します。</span>
              ) : (
                <span className="block pt-1">
                  登録数が表示数以下のため、全ハムスターを表示します。
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
            aria-labelledby="dashboard-hamster-order-heading"
            data-dashboard-hamster-order
          >
            <div className="space-y-1">
              <div className="flex items-start justify-between gap-3">
                <h4 id="dashboard-hamster-order-heading" className="text-base font-bold text-ink">
                  ダッシュボードカードの並び順
                </h4>
                <span className="shrink-0 whitespace-nowrap text-xs font-medium tabular-nums text-slate-500 sm:hidden">
                  全{orderedHamsters.length}件
                </span>
              </div>
              <p id="dashboard-hamster-order-help" className="text-xs leading-5 text-slate-500">
                PCではドラッグハンドルまたは上下ボタンで並び替えられます。スマートフォンでは上下ボタンを使用してください。
              </p>
            </div>

            {orderedHamsters.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">
                表示対象のハムスターはいません。
              </div>
            ) : (
              <ol
                ref={orderListRef}
                className="-mr-11 flex max-h-[var(--dashboard-order-max-height)] flex-col gap-2 overflow-x-hidden overflow-y-auto overscroll-contain [--dashboard-order-max-height:min(55vh,28rem)] supports-[height:1dvh]:[--dashboard-order-max-height:min(55dvh,28rem)] sm:mr-0 sm:max-h-none sm:overflow-visible sm:overscroll-auto"
                aria-describedby="dashboard-hamster-order-help"
                onDragOver={handleOrderListDragOver}
                onDragLeave={handleOrderListDragLeave}
                onDrop={handleOrderListDrop}
              >
                {orderedHamsters.map((hamster, index) => {
                  const isDropTarget = dropTarget?.hamsterId === hamster.id;
                  const isDropBefore = isDropTarget && dropTarget.position === "before";
                  const isDropAfter = isDropTarget && dropTarget.position === "after";
                  const dropSpacingClass = isDropBefore ? "sm:mt-2" : isDropAfter ? "sm:mb-2" : "";
                  const beforeLinePositionClass = index === 0 ? "sm:-top-1.5" : "sm:-top-2.5";
                  const afterLinePositionClass =
                    index === orderedHamsters.length - 1 ? "sm:-bottom-1.5" : "sm:-bottom-2.5";
                  const isDragging = draggedId === hamster.id;
                  const isRecentlyMoved = recentMove?.hamsterId === hamster.id;
                  const rowStateClass = isDropTarget
                    ? "border-moss bg-moss/10 ring-2 ring-moss/20"
                    : isRecentlyMoved
                      ? "border-moss/70 bg-moss/10"
                      : "border-slate-200 bg-white sm:hover:border-slate-300 sm:hover:bg-slate-50";

                  return (
                    <li
                      key={hamster.id}
                      data-dashboard-hamster-order-id={hamster.id}
                      onDragOver={(event) => handleDragOver(event, hamster.id)}
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
                          className={`pointer-events-none absolute -top-1.5 left-2 right-2 z-10 h-1 rounded-full bg-moss shadow-sm ${beforeLinePositionClass}`}
                        />
                      ) : null}
                      {isDropAfter ? (
                        <span
                          aria-hidden="true"
                          data-drop-indicator="after"
                          className={`pointer-events-none absolute -bottom-1.5 left-2 right-2 z-10 h-1 rounded-full bg-moss shadow-sm ${afterLinePositionClass}`}
                        />
                      ) : null}
                      <span
                        data-dashboard-hamster-rank
                        aria-label={`${index + 1}番目`}
                        className="flex min-w-0 items-center justify-center border-r border-slate-200 px-1 text-sm font-bold tabular-nums text-slate-600 sm:hidden"
                      >
                        {index + 1}
                      </span>
                      <div
                        data-dashboard-hamster-row-content
                        className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 p-2 sm:contents"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <button
                            type="button"
                            draggable
                            onDragStart={(event) => handleDragStart(event, hamster.id)}
                            onDragEnd={handleDragEnd}
                            aria-label={`${hamster.name}をドラッグして並び替え`}
                            aria-roledescription="並び替えハンドル"
                            className="hidden h-11 w-11 shrink-0 cursor-grab items-center justify-center rounded-md border border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss focus-visible:ring-offset-2 sm:inline-flex"
                          >
                            <GripVertical className="h-5 w-5" aria-hidden />
                          </button>
                          <span className="min-w-0">
                            <span className="block break-words text-sm font-semibold text-ink">
                              {hamster.name}
                            </span>
                            <span
                              className={`mt-1 inline-flex shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold ${
                                hamster.isActive
                                  ? "bg-straw/40 text-slate-700"
                                  : "bg-slate-200 text-slate-600"
                              }`}
                            >
                              {hamster.isActive ? "管理中" : "管理外"}
                            </span>
                          </span>
                        </div>

                        <div className="grid shrink-0 grid-cols-2 gap-2" aria-label={`${hamster.name}の並び替え操作`}>
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => moveByOffset(hamster.id, "up")}
                            aria-label={`${hamster.name}を上へ移動`}
                            data-move-feedback={isRecentlyMoved && recentMove.direction === "up" ? "true" : undefined}
                            className={`inline-flex h-11 w-11 items-center justify-center rounded-md border transition-colors duration-200 motion-reduce:transition-none disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss focus-visible:ring-offset-2 ${
                              isRecentlyMoved && recentMove.direction === "up"
                                ? "border-moss bg-moss/[0.15] text-moss hover:bg-moss/20 disabled:border-moss disabled:bg-moss/[0.15] disabled:text-moss disabled:opacity-70"
                                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:bg-slate-100 disabled:text-slate-400"
                            }`}
                          >
                            <ArrowUp className="h-4 w-4" aria-hidden />
                          </button>
                          <button
                            type="button"
                            disabled={index === orderedHamsters.length - 1}
                            onClick={() => moveByOffset(hamster.id, "down")}
                            aria-label={`${hamster.name}を下へ移動`}
                            data-move-feedback={isRecentlyMoved && recentMove.direction === "down" ? "true" : undefined}
                            className={`inline-flex h-11 w-11 items-center justify-center rounded-md border transition-colors duration-200 motion-reduce:transition-none disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss focus-visible:ring-offset-2 ${
                              isRecentlyMoved && recentMove.direction === "down"
                                ? "border-moss bg-moss/[0.15] text-moss hover:bg-moss/20 disabled:border-moss disabled:bg-moss/[0.15] disabled:text-moss disabled:opacity-70"
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

          {/* disabled の checkbox は送信されないため、保存対象IDは hidden input に正規化して渡す。 */}
          {selectedIds.map((id) => (
            <input key={id} type="hidden" name="hamsterIds" value={id} data-dirty-control />
          ))}

          <section
            className="space-y-3 border-t border-slate-200 pt-5"
            aria-labelledby="dashboard-hamster-selection-heading"
            data-dashboard-hamster-selection
          >
            <h4 id="dashboard-hamster-selection-heading" className="text-base font-bold text-ink">
              ダッシュボードに表示するハムスター
            </h4>
        {hamsters.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            ハムスターがまだ登録されていません。
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
                    placeholder="ハムスター名で検索"
                  />
                </span>
              </label>
              <div className="space-y-1.5">
                <span className="block text-sm font-medium text-slate-700">状態</span>
                <div
                  className="grid grid-cols-4 rounded-xl bg-slate-100 p-1 sm:flex sm:flex-wrap sm:gap-2 sm:rounded-none sm:bg-transparent sm:p-0"
                  aria-label="ハムスターの状態で絞り込む"
                >
                  {HAMSTER_STATUS_FILTERS.map((filter) => {
                    const isSelected = statusFilter === filter.value;

                    return (
                      <button
                        key={filter.value}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setStatusFilter(filter.value)}
                        className={`flex min-h-11 min-w-0 items-center justify-center whitespace-nowrap rounded-lg px-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss focus-visible:ring-offset-1 sm:min-h-0 sm:rounded-md sm:border sm:px-3 sm:py-1.5 sm:text-sm sm:font-semibold ${
                          isSelected
                            ? "bg-moss/10 text-moss ring-1 ring-inset ring-moss/20 sm:border-moss sm:bg-moss sm:text-white sm:ring-0"
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
              {hamsters.length} 件中 {filteredHamsters.length} 件が条件に一致しています。
            </p>

            {filteredHamsters.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                {statusFilter === "selected"
                  ? "選択中のハムスターはいません。"
                  : "条件に一致するハムスターはいません。"}
              </div>
            ) : (
              <div className="max-h-[50vh] divide-y divide-slate-200 overflow-y-auto rounded-md border border-slate-200 sm:max-h-96 lg:max-h-[28rem]">
                {filteredHamsters.map((hamster) => {
                  const checked = selectedIdSet.has(hamster.id);
                  // 上限に達した後は未選択の行だけを無効化し、選択済みの解除はできるようにする。
                  const disabled = !checked && needsSelection && selectedIds.length >= limit;

                  return (
                    <label
                      key={hamster.id}
                      className={`flex items-start gap-3 px-4 py-3 text-sm ${
                        disabled ? "cursor-not-allowed bg-slate-50 text-slate-400" : "cursor-pointer text-slate-700"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!needsSelection || disabled}
                        onChange={() => handleToggle(hamster.id)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                          {hamster.name}
                          {hamster.isActive ? null : (
                            <span className="rounded-md bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">
                              管理外
                            </span>
                          )}
                        </span>
                        {hamster.memo ? <span className="mt-1 block truncate text-slate-500">{hamster.memo}</span> : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </>
        )}
          </section>
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
          <div className="flex justify-end pr-16 sm:pr-20 xl:pr-0">
            <DirtySubmitButton
              disabled={!canSave || isSaving}
              className="inline-flex items-center gap-2 rounded-md bg-moss px-5 py-2.5 text-sm font-semibold text-white hover:bg-moss/90 disabled:cursor-not-allowed disabled:bg-slate-300"
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
