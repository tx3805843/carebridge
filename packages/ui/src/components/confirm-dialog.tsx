"use client";

import * as React from "react";
import { Button, type ButtonProps } from "./button";

export interface ConfirmSubmitButtonProps extends ButtonProps {
  // Per the UX review's confirmation-dialog rule: state the consequence and name the affected
  // record, not a generic "Are you sure?" — callers pass a description built from real data.
  confirmTitle: string;
  confirmDescription: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
}

// A submit button that gates its own form's submission behind a native <dialog> confirmation.
// Must be rendered inside the <form> it confirms — the trigger button stays type="button", the
// dialog's own confirm button is the real type="submit" (still a descendant of that <form> once
// the <dialog> is open, so its submission works normally).
export function ConfirmSubmitButton({
  confirmTitle,
  confirmDescription,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  children,
  onClick,
  ...buttonProps
}: ConfirmSubmitButtonProps) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);

  return (
    <>
      <Button
        type="button"
        {...buttonProps}
        onClick={(event) => {
          onClick?.(event);
          dialogRef.current?.showModal();
        }}
      >
        {children}
      </Button>
      <dialog
        ref={dialogRef}
        className="w-full max-w-sm rounded-md border border-border bg-surface p-0 text-foreground shadow-lg backdrop:bg-black/40"
      >
        <div className="flex flex-col gap-3 p-5">
          <h2 className="text-base font-semibold">{confirmTitle}</h2>
          <div className="text-sm text-muted-foreground">{confirmDescription}</div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => dialogRef.current?.close()}>
              {cancelLabel}
            </Button>
            <Button type="submit" size="sm" onClick={() => dialogRef.current?.close()}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
