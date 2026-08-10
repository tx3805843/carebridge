"use client";

import * as React from "react";
import { cn } from "../lib/cn";

export type ToastVariant = "success" | "critical" | "information";

interface ToastMessage {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  showToast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

const TOAST_VARIANT_CLASSES: Record<ToastVariant, string> = {
  success: "border-success/20 bg-success text-success-foreground",
  critical: "border-critical/20 bg-critical text-critical-foreground",
  information: "border-information/20 bg-information text-information-foreground",
};

// Ephemeral confirmation for lower-stakes actions (e.g. "roster assignment added"). Per the UX
// review: "Toast plus persistent inline confirmation for high-impact actions" — a safeguarding
// resolution or a generated invoice should stay as permanent inline text, not a toast that
// disappears in 5 seconds. Reach for this only where losing the message costs nothing.
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastMessage[]>([]);
  const nextId = React.useRef(0);

  const showToast = React.useCallback((message: string, variant: ToastVariant = "success") => {
    const id = String(nextId.current++);
    setToasts((current) => [...current, { id, message, variant }]);
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 5000);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={cn(
              "pointer-events-auto rounded-md border px-4 py-2 text-sm shadow-md",
              TOAST_VARIANT_CLASSES[toast.variant],
            )}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
