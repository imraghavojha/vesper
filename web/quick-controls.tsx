import { useEffect, useState } from "react";
import type { QuickChatStatus } from "../shared/desktop.js";
export function QuickControls() {
  const bridge = window.vesperDesktop;
  const [status, setStatus] = useState<QuickChatStatus | null>(null);
  const [requested, setRequested] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!bridge) return;
    void bridge
      .quickChatStatus()
      .then((value) => {
        setStatus(value);
        setRequested(value.requested);
      })
      .catch(() => setError("Quick chat is unavailable."));
    return bridge.onQuickStatus(setStatus);
  }, [bridge]);
  if (!bridge) return null;
  return (
    <div className="quick-controls">
      <p className="quick-controls__status" role="status">
        {status?.active ? (
          <>
            Shortcut <kbd>{status.active}</kbd>
          </>
        ) : (
          "No global shortcut active. Use the menu-bar action."
        )}
      </p>
      <form
        className="quick-controls__form"
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          void bridge
            .setQuickShortcut(requested)
            .then(setStatus)
            .catch(() => setError("That shortcut could not be configured."));
        }}
      >
        <label htmlFor="quick-shortcut">Global shortcut</label>
        <div className="quick-controls__row">
          <input
            id="quick-shortcut"
            value={requested}
            maxLength={80}
            spellCheck={false}
            onChange={(event) => setRequested(event.target.value)}
          />
          <button className="pill-button" aria-label="Set global shortcut">
            Set
          </button>
        </div>
      </form>
      <button
        className="pill-button"
        onClick={() =>
          void bridge
            .showQuickChat()
            .catch(() => setError("Quick chat could not open."))
        }
      >
        Open quick chat
      </button>
      {(error || status?.error) && (
        <p className="panel-error" role="alert">
          {error || status?.error}
        </p>
      )}
    </div>
  );
}
