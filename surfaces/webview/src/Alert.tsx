import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "./state/store";
import { haptics } from "./haptics";

// Terminal-styled alert plaque — the single visual for every alert in the app
// (design: "Component · Alert"). Reusable on its own: pass a message plus optional
// action buttons. The store-driven `Alert` host below uses it for transient toasts,
// but a caller can render <AlertCard> directly for a confirm/error dialog.
export type AlertKind = "ALERT" | "CONFIRM" | "ERROR";
export type AlertAction = { label: string; onClick: () => void; variant?: "solid" | "ghost" | "base" };

export function AlertCard({
  kind = "ALERT",
  message,
  onClose,
  actions,
  className = "",
}: {
  kind?: AlertKind;
  message: string;
  onClose?: () => void;
  actions?: AlertAction[];
  className?: string;
}) {
  return (
    <div className={`an-alert ${className}`} role="alertdialog" aria-label={kind}>
      <div className="an-alert-head">
        <span>&gt;{kind}</span>
        {onClose && (
          <button type="button" className="an-alert-x" aria-label="Dismiss" onClick={onClose}>
            [x]
          </button>
        )}
      </div>
      <p className="an-alert-msg">{message}</p>
      {actions && actions.length > 0 && (
        <div className="an-alert-row">
          {actions.map((a, i) => (
            <button
              key={i}
              type="button"
              className={`an-alert-btn${a.variant && a.variant !== "base" ? ` ${a.variant}` : ""}`}
              onClick={a.onClick}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Words that mark a message as a failure — shown with the >ERROR head. Everything
// else reads as a neutral >ALERT. (The toast channel is a plain string, so the kind
// is inferred; callers rendering AlertCard directly can pass kind explicitly.)
const ERROR_HINT = /\b(fail|failed|error|denied|cancell?ed|insufficient|invalid|unable|rejected|congested)\b/i;

// Overlay host for the app's transient alert channel (`state.toast`). Each message
// flickers in, holds briefly, then blinks out on its own — like a real alert()
// vanishing. Tapping the card, [x], or OK dismisses it early. The scrim is
// pointer-events-none so a low-priority alert never traps the user's next tap.
export function Alert() {
  const { state, clearToast } = useStore();
  const [shown, setShown] = useState<string | null>(null); // latched text, kept through the leave animation
  const [leaving, setLeaving] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    holdTimer.current = leaveTimer.current = null;
  };

  // Begin the blink-out, then clear the store once it finishes.
  const dismiss = useCallback(() => {
    clearTimers();
    setLeaving(true);
    leaveTimer.current = setTimeout(() => {
      setShown(null);
      setLeaving(false);
      clearToast();
    }, 420); // matches .an-alert-leave
  }, [clearToast]);

  // A new toast arrives → latch it, flicker in, arm the auto-dismiss hold.
  useEffect(() => {
    if (!state.toast) return;
    clearTimers();
    setShown(state.toast);
    setLeaving(false);
    haptics.tick();
    const hold = Math.min(5000, 2000 + state.toast.length * 45); // longer text lingers a touch longer
    holdTimer.current = setTimeout(dismiss, hold);
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.toast]);

  useEffect(() => clearTimers, []);

  if (!shown) return null;
  const kind: AlertKind = ERROR_HINT.test(shown) ? "ERROR" : "ALERT";

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center px-6">
      <div className="pointer-events-auto w-full max-w-[300px]">
        <AlertCard
          kind={kind}
          message={shown}
          onClose={dismiss}
          className={leaving ? "an-alert-leave" : "an-alert-enter"}
          actions={[{ label: "OK", onClick: dismiss, variant: "solid" }]}
        />
      </div>
    </div>
  );
}
