import { CheckIcon } from "../icons";
import type { ToastKind } from "../store";

// Error / info glyphs (success reuses the shared CheckIcon).
function ErrorIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
      <line x1="8" y1="4.5" x2="8" y2="9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="11.4" r="0.95" fill="currentColor" />
    </svg>
  );
}

export function Toast({ message, kind = "success" }: { message: string; kind?: ToastKind }) {
  const color =
    kind === "error" ? "var(--danger, #e0556f)" : kind === "info" ? "var(--text-2)" : "var(--accent)";
  return (
    <div className="toast" data-kind={kind} role="status" aria-live="polite">
      <span style={{ color, display: "inline-flex" }}>
        {kind === "error" ? <ErrorIcon size={15} /> : <CheckIcon size={15} />}
      </span>
      {message}
    </div>
  );
}
