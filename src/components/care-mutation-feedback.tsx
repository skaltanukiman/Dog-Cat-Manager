"use client";

import type { ButtonHTMLAttributes, FormHTMLAttributes, ReactNode, SubmitEvent } from "react";
import { createContext, useContext, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { AutoDismissSuccessMessage } from "@/components/status-message";
import {
  CARE_MUTATION_SUCCESS_MESSAGES,
  type CareMutationResult
} from "@/lib/care-mutation";

type CareMutationAction = (formData: FormData) => Promise<CareMutationResult>;

type CareMutationContextValue = {
  isPending: boolean;
  submit: (form: HTMLFormElement, action: CareMutationAction, resetOnSuccess: boolean) => void;
};

const CareMutationContext = createContext<CareMutationContextValue | null>(null);

/**
 * Careの各Disclosure内で成功通知と再取得を共有する。
 * 成功時はURL遷移を行わずrouter.refreshだけを使うため、Disclosureの開閉状態とスクロール位置を保てる。
 */
export function CareMutationFeedback({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [success, setSuccess] = useState<{ key: number; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(form: HTMLFormElement, action: CareMutationAction, resetOnSuccess: boolean) {
    startTransition(async () => {
      const result = await action(new FormData(form));
      if (resetOnSuccess) form.reset();
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
  onSubmit,
  children,
  ...props
}: Omit<FormHTMLAttributes<HTMLFormElement>, "action"> & {
  action: CareMutationAction;
  resetOnSuccess?: boolean;
}) {
  const context = useContext(CareMutationContext);
  if (!context) throw new Error("CareMutationForm must be rendered within CareMutationFeedback.");
  const mutationContext = context;

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    onSubmit?.(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    mutationContext.submit(event.currentTarget, action, resetOnSuccess);
  }

  return <form {...props} onSubmit={handleSubmit}>{children}</form>;
}

export function CareMutationSubmitButton({
  children,
  pendingLabel,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & { pendingLabel: string }) {
  const context = useContext(CareMutationContext);
  if (!context) throw new Error("CareMutationSubmitButton must be rendered within CareMutationFeedback.");

  return <button {...props} type="submit" disabled={context.isPending || props.disabled}>{context.isPending ? pendingLabel : children}</button>;
}
