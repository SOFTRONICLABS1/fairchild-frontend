"use client";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

type Toast = { id: number; message: string; type: "success" | "error" };
const ToastCtx = createContext<{ push: (message: string, type: Toast["type"]) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, type: Toast["type"]) => {
    const id = Date.now();
    setToasts((s) => [...s, { id, message, type }]);
    setTimeout(() => setToasts((s) => s.filter((t) => t.id !== id)), 2000);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return <ToastCtx.Provider value={value}>{children}
    <div className="fixed right-4 top-4 z-50 space-y-2">{toasts.map((t) => <div key={t.id} className={`rounded px-3 py-2 text-sm text-white ${t.type === "success" ? "bg-emerald-600" : "bg-red-600"}`}>{t.message}</div>)}</div>
  </ToastCtx.Provider>;
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
