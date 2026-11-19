"use client";

import { useEffect, type RefObject } from "react";

/**
 * After each form response (`nonce` changes), bring the feedback into view and move focus to it,
 * so the remount of the fields does not leave the user at the top of the page. Goes to a message
 * box that is a direct child of the form (form-level error, duplicate warning), else the first
 * field marked invalid.
 */
export function useFocusOnFeedback(formRef: RefObject<HTMLFormElement | null>, nonce?: number) {
  useEffect(() => {
    if (nonce === undefined) return;
    const form = formRef.current;
    if (!form) return;
    const box = form.querySelector<HTMLElement>(":scope > [role='alert']");
    const target = box ?? form.querySelector<HTMLElement>("[aria-invalid='true']");
    if (!target) return;
    if (box) box.tabIndex = -1;
    target.focus();
    target.scrollIntoView({ block: "center" });
  }, [formRef, nonce]);
}
