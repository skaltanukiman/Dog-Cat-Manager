"use client";

import type { ButtonHTMLAttributes, FormEvent, FormHTMLAttributes, ReactNode, SubmitEvent } from "react";
import { createContext, useContext, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { AutoDismissSuccessMessage } from "@/components/status-message";
import {
  CARE_MUTATION_SUCCESS_MESSAGES,
  getCareMutationFieldSnapshot,
  type CareMutationResult
} from "@/lib/care-mutation";

type CareMutationAction = (formData: FormData) => Promise<CareMutationResult>;

type CareMutationContextValue = {
  isPending: boolean;
  submit: (
    form: HTMLFormElement,
    action: CareMutationAction,
    resetOnSuccess: boolean,
    onSuccess?: () => void
  ) => void;
};

const CareMutationContext = createContext<CareMutationContextValue | null>(null);
const CareMutationFormContext = createContext<{ isDirty: boolean; requireChanges: boolean } | null>(null);

/**
 * Careの各Disclosure内で成功通知と再取得を共有する。
 * 成功時はURL遷移を行わずrouter.refreshだけを使うため、Disclosureの開閉状態とスクロール位置を保てる。
 */
export function CareMutationFeedback({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [success, setSuccess] = useState<{ key: number; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(
    form: HTMLFormElement,
    action: CareMutationAction,
    resetOnSuccess: boolean,
    onSuccess?: () => void
  ) {
    startTransition(async () => {
      const result = await action(new FormData(form));
      if (resetOnSuccess) form.reset();
      onSuccess?.();
      setSuccess((current) => ({
        key: (current?.key ?? 0) + 1,
        message: CARE_MUTATION_SUCCESS_MESSAGES[result.status]
      }));
      router.refresh();
    });
  }

  return (
    <CareMutationContext.Provider value={{ isPending, submit }}>
      <div className="space-y-4">
        {success ? <AutoDismissSuccessMessage key={success.key} message={success.message} /> : null}
        {children}
      </div>
    </CareMutationContext.Provider>
  );
}

export function CareMutationForm({
  action,
  resetOnSuccess = false,
  requireChanges = false,
  changeFieldNames = [],
  onSubmit,
  onInput,
  onChange,
  children,
  ...props
}: Omit<FormHTMLAttributes<HTMLFormElement>, "action"> & {
  action: CareMutationAction;
  resetOnSuccess?: boolean;
  requireChanges?: boolean;
  changeFieldNames?: readonly string[];
}) {
  const context = useContext(CareMutationContext);
  if (!context) throw new Error("CareMutationForm must be rendered within CareMutationFeedback.");
  const mutationContext = context;
  const formRef = useRef<HTMLFormElement>(null);
  const initialSnapshotRef = useRef<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const fieldNamesKey = changeFieldNames.join("\u0000");

  useEffect(() => {
    const form = formRef.current;
    if (!requireChanges || !form) return;
    initialSnapshotRef.current = getCareMutationFieldSnapshot(new FormData(form), changeFieldNames);
    setIsDirty(false);
  }, [changeFieldNames, fieldNamesKey, requireChanges]);

  function updateDirtyState(form: HTMLFormElement) {
    if (!requireChanges || !initialSnapshotRef.current) return;
    setIsDirty(getCareMutationFieldSnapshot(new FormData(form), changeFieldNames) !== initialSnapshotRef.current);
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    onSubmit?.(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    const form = event.currentTarget;
    mutationContext.submit(form, action, resetOnSuccess, () => {
      if (!requireChanges) return;
      initialSnapshotRef.current = getCareMutationFieldSnapshot(new FormData(form), changeFieldNames);
      setIsDirty(false);
    });
  }

  function handleFieldChange(event: FormEvent<HTMLFormElement>) {
    updateDirtyState(event.currentTarget);
  }

  return (
    <CareMutationFormContext.Provider value={{ isDirty, requireChanges }}>
      <form ref={formRef} {...props} onSubmit={handleSubmit} onInput={onInput} onChange={(event) => {
        onChange?.(event);
        handleFieldChange(event);
      }}>
        {children}
      </form>
    </CareMutationFormContext.Provider>
  );
}

export function CareMutationSubmitButton({
  children,
  pendingLabel,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & { pendingLabel: string }) {
  const context = useContext(CareMutationContext);
  if (!context) throw new Error("CareMutationSubmitButton must be rendered within CareMutationFeedback.");
  const formContext = useContext(CareMutationFormContext);
  const isDisabled = context.isPending || props.disabled || Boolean(formContext?.requireChanges && !formContext.isDirty);

  return <button {...props} type="submit" disabled={isDisabled}>{context.isPending ? pendingLabel : children}</button>;
}
