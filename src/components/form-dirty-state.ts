"use client";

import type { RefObject } from "react";
import { useEffect, useState } from "react";

const initialFormSnapshots = new WeakMap<HTMLFormElement, string>();
export const FORM_DIRTY_REEVALUATE_EVENT = "form-dirty-reevaluate";

export function requestFormDirtyReevaluation(form: HTMLFormElement | null) {
  if (!form) {
    return;
  }

  // Reactによるhidden inputのDOM順更新後に、初期スナップショットとの差分を再評価する。
  window.requestAnimationFrame(() => {
    document.dispatchEvent(
      new CustomEvent(FORM_DIRTY_REEVALUATE_EVENT, {
        detail: { form },
      }),
    );
  });
}

function isSubmittableControl(element: Element): element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  return element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement;
}

function normalizeInputValue(input: HTMLInputElement) {
  if (input.type === "checkbox" || input.type === "radio") {
    return input.checked ? "checked" : "unchecked";
  }

  if (input.type === "number") {
    const value = input.value.trim();
    return value.length > 0 && Number.isFinite(Number(value)) ? String(Number(value)) : value;
  }

  if (input.type === "text" || input.type === "search") {
    return input.value.trim();
  }

  return input.value;
}

function normalizeControlValue(control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) {
  if (control instanceof HTMLInputElement) {
    return normalizeInputValue(control);
  }

  if (control instanceof HTMLSelectElement && control.multiple) {
    return Array.from(control.selectedOptions)
      .map((option) => option.value)
      .join(",");
  }

  return control.value.trim();
}

function shouldTrackControl(control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) {
  if (!control.name || control.disabled) {
    return false;
  }

  if (control instanceof HTMLInputElement) {
    if (control.type === "hidden") {
      return control.hasAttribute("data-dirty-control");
    }

    return !["button", "reset", "submit"].includes(control.type);
  }

  return true;
}

function getFormSnapshot(form: HTMLFormElement) {
  return Array.from(form.elements)
    .filter((element): element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement => {
      return isSubmittableControl(element) && shouldTrackControl(element);
    })
    .map((control) => `${control.name}:${control.type}:${normalizeControlValue(control)}`)
    .join("\n");
}

export function isFormDirty(form: HTMLFormElement) {
  let initialSnapshot = initialFormSnapshots.get(form);

  if (initialSnapshot === undefined) {
    initialSnapshot = getFormSnapshot(form);
    initialFormSnapshots.set(form, initialSnapshot);
  }

  return getFormSnapshot(form) !== initialSnapshot;
}

export function hasDirtyForms() {
  return Array.from(document.querySelectorAll<HTMLFormElement>("form[data-dirty-watch]")).some(isFormDirty);
}

function subscribeToFormDirty(form: HTMLFormElement, onDirtyChange: (isDirty: boolean) => void) {
  if (!initialFormSnapshots.has(form)) {
    initialFormSnapshots.set(form, getFormSnapshot(form));
  }

  let updateFrame: number | null = null;

  function updateDirtyState() {
    onDirtyChange(isFormDirty(form));
  }

  function scheduleDirtyStateUpdate() {
    if (updateFrame !== null) {
      window.cancelAnimationFrame(updateFrame);
    }

    updateFrame = window.requestAnimationFrame(() => {
      updateFrame = null;
      updateDirtyState();
    });
  }

  function handleDirtyReevaluation(event: Event) {
    const eventForm = (event as CustomEvent<{ form?: unknown }>).detail?.form;

    if (eventForm === form) {
      scheduleDirtyStateUpdate();
    }
  }

  updateDirtyState();
  form.addEventListener("input", scheduleDirtyStateUpdate);
  form.addEventListener("change", scheduleDirtyStateUpdate);
  form.addEventListener("reset", scheduleDirtyStateUpdate);
  document.addEventListener(FORM_DIRTY_REEVALUATE_EVENT, handleDirtyReevaluation);

  return () => {
    if (updateFrame !== null) {
      window.cancelAnimationFrame(updateFrame);
    }
    form.removeEventListener("input", scheduleDirtyStateUpdate);
    form.removeEventListener("change", scheduleDirtyStateUpdate);
    form.removeEventListener("reset", scheduleDirtyStateUpdate);
    document.removeEventListener(FORM_DIRTY_REEVALUATE_EVENT, handleDirtyReevaluation);
  };
}

export function useButtonFormDirty(buttonRef: RefObject<HTMLButtonElement | null>, disabled = false) {
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (disabled) {
      return;
    }

    const form = buttonRef.current?.form;

    if (!form) {
      return;
    }

    return subscribeToFormDirty(form, setIsDirty);
  }, [buttonRef, disabled]);

  return isDirty;
}

export function useFormDirtyById(formId: string, disabled = false) {
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (disabled) {
      return;
    }

    const form = document.getElementById(formId);

    if (!(form instanceof HTMLFormElement)) {
      return;
    }

    return subscribeToFormDirty(form, setIsDirty);
  }, [disabled, formId]);

  return isDirty;
}
