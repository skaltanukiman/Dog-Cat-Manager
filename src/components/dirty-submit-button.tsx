"use client";

import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
import { useRef } from "react";

import { useButtonFormDirty } from "@/components/form-dirty-state";
import { REALTIME_LOCAL_SUBMIT_EVENT } from "@/lib/realtime-constants";

type DirtySubmitButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  allowPristineSubmit?: boolean;
};

export function DirtySubmitButton({
  children,
  disabled = false,
  allowPristineSubmit = false,
  onClick,
  title,
  ...props
}: DirtySubmitButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const isDirty = useButtonFormDirty(buttonRef, disabled);
  const isDisabled = disabled || (!allowPristineSubmit && !isDirty);

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    onClick?.(event);

    if (event.defaultPrevented) {
      return;
    }

    const form = event.currentTarget.form;

    if (form && (form.method.toLowerCase() !== "get" || form.hasAttribute("data-dirty-watch"))) {
      window.dispatchEvent(new CustomEvent(REALTIME_LOCAL_SUBMIT_EVENT, { detail: { form } }));
    }
  }

  return (
    <button
      {...props}
      ref={buttonRef}
      type="submit"
      disabled={isDisabled}
      data-dirty={isDirty ? "true" : "false"}
      onClick={handleClick}
      title={title ?? (!allowPristineSubmit && !disabled && !isDirty ? "変更すると保存できます" : undefined)}
    >
      {children}
    </button>
  );
}
