export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

let nextId = 1;

export const toasts = $state<Toast[]>([]);

function push(kind: ToastKind, message: string, ttlMs: number) {
  const id = nextId++;
  toasts.push({ id, kind, message });
  setTimeout(() => dismiss(id), ttlMs);
}

export function dismiss(id: number) {
  const i = toasts.findIndex((t) => t.id === id);
  if (i !== -1) toasts.splice(i, 1);
}

export const toastInfo = (message: string) => push("info", message, 3500);
export const toastSuccess = (message: string) => push("success", message, 3500);
export const toastError = (message: string) => push("error", message, 7000);
