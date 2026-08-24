"use client";

import { driver, type DriveStep, type Driver, type PopoverDOM } from "driver.js";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode
} from "react";

import { completeCurrentOnboarding } from "@/app/actions/tutorial";
import {
  createInitialTutorialProgress,
  createReplayTutorialProgress,
  isOnboardingRequired,
  markTutorialPetCreated,
  parseTutorialProgress,
  TUTORIAL_SESSION_STORAGE_KEY,
  type TutorialProgress
} from "@/lib/tutorial";

type TutorialContextValue = {
  startReplay: () => void;
  notifyPetCreated: (petId: string) => void;
};

const TutorialContext = createContext<TutorialContextValue | null>(null);

function navTarget(name: "pets" | "records" | "weights") {
  const viewport = window.matchMedia("(min-width: 1024px)").matches ? "desktop" : "mobile";
  return `[data-tutorial="nav-${name}-${viewport}"]`;
}

function createdPetCareTarget(petId: string) {
  return `[data-tutorial="dashboard-care-button"][data-tutorial-pet-id="${petId}"]`;
}

/**
 * Driver.jsのページ内表示と、sessionStorageに置くページ間phaseを接続する。
 * DBへ書き込むのはinitialの完了・明示的スキップだけで、replayは常に読み取り専用にする。
 */
export function TutorialProvider({
  children,
  onboardingVersion,
  canCreatePets,
  hasPets
}: {
  children: ReactNode;
  onboardingVersion: number;
  canCreatePets: boolean;
  hasPets: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const driverRef = useRef<Driver | null>(null);
  const welcomeDialogRef = useRef<HTMLDivElement>(null);
  const welcomePrimaryButtonRef = useRef<HTMLButtonElement>(null);
  const [hydrated, setHydrated] = useState(false);
  const [progress, setProgress] = useState<TutorialProgress | null>(null);
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const [locallyCompleted, setLocallyCompleted] = useState(false);
  const [completionError, setCompletionError] = useState(false);

  const saveProgress = useCallback((next: TutorialProgress | null) => {
    setProgress(next);
    if (next) {
      window.sessionStorage.setItem(TUTORIAL_SESSION_STORAGE_KEY, JSON.stringify(next));
    } else {
      window.sessionStorage.removeItem(TUTORIAL_SESSION_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      const restored = parseTutorialProgress(window.sessionStorage.getItem(TUTORIAL_SESSION_STORAGE_KEY));
      if (!restored) window.sessionStorage.removeItem(TUTORIAL_SESSION_STORAGE_KEY);
      setProgress(restored);
      setHydrated(true);
    }, 0);

    return () => window.clearTimeout(restoreTimer);
  }, []);

  const completeInitial = useCallback(async () => {
    setCompletionError(false);
    try {
      await completeCurrentOnboarding();
      driverRef.current?.destroy();
      saveProgress(null);
      setLocallyCompleted(true);
      router.refresh();
    } catch {
      setCompletionError(true);
    }
  }, [router, saveProgress]);

  const closeOrSkip = useCallback(async () => {
    if (progress?.mode === "initial") {
      await completeInitial();
      return;
    }

    driverRef.current?.destroy();
    saveProgress(null);
  }, [completeInitial, progress?.mode, saveProgress]);

  const startInitial = useCallback(() => {
    setCompletionError(false);
    saveProgress(createInitialTutorialProgress(canCreatePets));
    if (pathname !== "/") router.push("/");
  }, [canCreatePets, pathname, router, saveProgress]);

  const startReplay = useCallback(() => {
    setCompletionError(false);
    saveProgress(createReplayTutorialProgress());
    router.push("/");
  }, [router, saveProgress]);

  const notifyPetCreated = useCallback((petId: string) => {
    setProgress((current) => {
      if (!current) return current;
      const next = markTutorialPetCreated(current, petId);
      if (next !== current) {
        window.sessionStorage.setItem(TUTORIAL_SESSION_STORAGE_KEY, JSON.stringify(next));
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!progress || progress.mode !== "initial") return;

    let next: TutorialProgress | null = null;
    if (progress.phase === "dashboard-register" && pathname === "/pets") {
      next = { ...progress, phase: "pets-create" };
    } else if (progress.phase === "dashboard-care" && pathname === "/care") {
      next = { ...progress, phase: "care-entry" };
    }

    if (!next) return;
    const navigationTimer = window.setTimeout(() => saveProgress(next), 0);
    return () => window.clearTimeout(navigationTimer);
  }, [pathname, progress, saveProgress]);

  useEffect(() => {
    driverRef.current?.destroy();
    driverRef.current = null;
    if (!hydrated || !progress) return;

    const configurePopover = (popover: PopoverDOM) => {
      popover.closeButton.style.display = "block";
      popover.closeButton.textContent = progress.mode === "initial" ? "スキップ" : "ガイドを終了";
      popover.closeButton.setAttribute(
        "aria-label",
        progress.mode === "initial" ? "オンボーディングをスキップ" : "再確認ガイドを終了"
      );
    };
    const commonConfig = {
      animate: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      allowClose: false,
      // ArrowRightで実リンクのクリックを飛ばさない。Tab / EnterとPopoverボタンは引き続き利用できる。
      allowKeyboardControl: false,
      allowScroll: true,
      disableActiveInteraction: true,
      overlayClickBehavior: () => undefined,
      overlayColor: "#17212b",
      overlayOpacity: 0.72,
      popoverClass: "dcm-tutorial-popover",
      popoverOffset: 12,
      showProgress: true,
      progressText: "{{current}} / {{total}}",
      nextBtnText: "次へ",
      prevBtnText: "戻る",
      doneBtnText: "完了",
      smoothScroll: true,
      stagePadding: 8,
      stageRadius: 8,
      waitForElement: 2500,
      skipMissingElement: true,
      onPopoverRender: configurePopover,
      onCloseClick: closeOrSkip
    } as const;

    let steps: DriveStep[] | null = null;

    if (progress.phase === "replay-overview" && pathname === "/") {
      steps = [
        {
          element: navTarget("pets"),
          popover: {
            title: hasPets ? "ペット管理" : "まずペットを登録してください",
            description: hasPets
              ? "ペットの追加やプロフィールの編集はこちらから行えます。再確認ガイドでは登録操作を行いません。"
              : "ペットを登録すると、お世話・体重・記録などの機能を利用できます。このガイドでは登録を強制しません。",
            side: "bottom",
            align: "center"
          }
        },
        ...(hasPets
          ? [
              {
                element: '[data-tutorial="dashboard-care-button"]',
                popover: {
                  title: "お世話",
                  description: "食事・水・散歩・トイレなどの日々のお世話を記録できます。ここではフォーム送信を行いません。",
                  side: "top" as const,
                  align: "start" as const
                }
              }
            ]
          : []),
        {
          element: navTarget("records"),
          popover: {
            title: "記録",
            description: "健康状態、通院、投薬、予防接種、思い出などの記録を管理できます。",
            side: "bottom",
            align: "center"
          }
        },
        {
          element: navTarget("weights"),
          popover: {
            title: "体重",
            description: "ペットの体重を記録し、変化を確認できます。",
            side: "bottom",
            align: "center"
          }
        },
        {
          popover: {
            title: "ガイドは以上です",
            description: "分からなくなった場合は、設定画面からいつでもこのガイドを確認できます。",
            doneBtnText: "完了",
            onDoneClick: () => {
              if (progress.mode === "initial") {
                void completeInitial();
              } else {
                driverRef.current?.destroy();
                saveProgress(null);
              }
            }
          }
        }
      ];
    } else if (progress.mode === "initial" && progress.phase === "dashboard-register" && pathname === "/") {
      steps = [
        {
          element: '[data-tutorial="dashboard-pet-register"]',
          advanceOnClick: true,
          disableActiveInteraction: false,
          popover: {
            title: "まずペットを登録しましょう",
            description: "一緒に暮らしている犬・猫を登録します。「ペット登録」をタップしてください。",
            showButtons: [],
            onDoneClick: () => saveProgress({ ...progress, phase: "pets-create" })
          }
        }
      ];
    } else if (progress.mode === "initial" && progress.phase === "pets-create" && pathname === "/pets") {
      steps = [
        {
          element: '[data-tutorial="pet-create-form"]',
          disableActiveInteraction: false,
          popover: {
            title: "ペットの情報を入力します",
            description: "名前・種類を入力し、必要に応じてその他の情報も登録できます。入力後、「登録」を押してください。",
            showButtons: [],
            side: "top",
            align: "start"
          }
        }
      ];
    } else if (progress.mode === "initial" && progress.phase === "pets-created" && pathname === "/pets") {
      steps = [
        {
          popover: {
            title: "登録できました！",
            description: "次は、この子のお世話を記録する場所をご案内します。",
            doneBtnText: "ダッシュボードへ",
            onDoneClick: () => {
              saveProgress({ ...progress, phase: "dashboard-care" });
              router.push(
                progress.createdPetId
                  ? `/?tutorialPetId=${encodeURIComponent(progress.createdPetId)}`
                  : "/"
              );
            }
          }
        }
      ];
    } else if (
      progress.mode === "initial" &&
      progress.phase === "dashboard-care" &&
      progress.createdPetId &&
      pathname === "/"
    ) {
      steps = [
        {
          element: createdPetCareTarget(progress.createdPetId),
          advanceOnClick: true,
          disableActiveInteraction: false,
          popover: {
            title: "お世話はこちらから記録します",
            description: "食事・水・散歩・トイレなど、その日のペットのお世話を記録できます。「お世話を記録」をタップしてください。",
            showButtons: [],
            side: "top",
            align: "start",
            onDoneClick: () => saveProgress({ ...progress, phase: "care-entry" })
          }
        }
      ];
    } else if (progress.mode === "initial" && progress.phase === "care-entry" && pathname === "/care") {
      steps = [
        {
          element: '[data-tutorial="care-entry"]',
          disableActiveInteraction: true,
          popover: {
            title: "お世話を記録できます",
            description: "ここでは、食事・水・散歩・猫トイレなどのお世話を記録できます。実際にお世話をしたときに使ってみてください。",
            doneBtnText: "ガイドを完了",
            side: "top",
            align: "start",
            onDoneClick: () => void completeInitial()
          }
        }
      ];
    }

    if (!steps) return;

    const currentDriver = driver({ ...commonConfig, steps });
    driverRef.current = currentDriver;
    currentDriver.drive();

    return () => {
      currentDriver.destroy();
      if (driverRef.current === currentDriver) driverRef.current = null;
    };
  }, [
    closeOrSkip,
    completeInitial,
    hasPets,
    hydrated,
    pathname,
    progress,
    router,
    saveProgress
  ]);

  const showWelcome =
    hydrated &&
    pathname === "/" &&
    !progress &&
    !welcomeDismissed &&
    !locallyCompleted &&
    isOnboardingRequired(onboardingVersion);

  useEffect(() => {
    if (!showWelcome) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    welcomePrimaryButtonRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, [showWelcome]);

  function handleWelcomeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setWelcomeDismissed(true);
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(
      welcomeDialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? []
    );
    if (focusable.length === 0) return;
    const currentIndex = focusable.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.shiftKey
      ? (currentIndex - 1 + focusable.length) % focusable.length
      : (currentIndex + 1) % focusable.length;
    event.preventDefault();
    focusable[nextIndex]?.focus();
  }

  const contextValue = useMemo(() => ({ startReplay, notifyPetCreated }), [notifyPetCreated, startReplay]);

  return (
    <TutorialContext.Provider value={contextValue}>
      {children}
      {showWelcome ? (
        <div
          className="fixed inset-0 z-[10000] grid place-items-center bg-slate-950/70 p-4"
          onKeyDown={handleWelcomeKeyDown}
        >
          <div
            ref={welcomeDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="tutorial-welcome-title"
            aria-describedby="tutorial-welcome-description"
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6"
          >
            <h2 id="tutorial-welcome-title" className="text-xl font-bold text-ink">
              Dog & Cat Managerへようこそ！
            </h2>
            <p id="tutorial-welcome-description" className="mt-3 text-sm leading-6 text-slate-600">
              基本的な使い方を簡単にご案内します。
            </p>
            {completionError ? (
              <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                完了状態を保存できませんでした。通信状態を確認して、もう一度お試しください。
              </p>
            ) : null}
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => void completeInitial()}
                className="min-h-11 rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
              >
                スキップ
              </button>
              <button
                ref={welcomePrimaryButtonRef}
                type="button"
                onClick={startInitial}
                className="min-h-11 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
              >
                使い方を見る
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {completionError && !showWelcome ? (
        <p
          role="alert"
          className="fixed bottom-4 left-1/2 z-[10002] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-md border border-red-200 bg-white px-4 py-3 text-sm text-red-700 shadow-lg"
        >
          完了状態を保存できませんでした。通信状態を確認して、もう一度お試しください。
        </p>
      ) : null}
    </TutorialContext.Provider>
  );
}

export function useTutorial() {
  const context = useContext(TutorialContext);
  if (!context) throw new Error("useTutorial must be used within TutorialProvider");
  return context;
}
