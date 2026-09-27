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
    <section className="quick-controls">
      <h3>Quick chat</h3>
      <button
        onClick={() =>
          void bridge
            .showQuickChat()
            .catch(() => setError("Quick chat could not open."))
        }
      >
        Open quick chat
      </button>
      <form
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
        <input
          id="quick-shortcut"
          value={requested}
          maxLength={80}
          onChange={(event) => setRequested(event.target.value)}
        />
        <button>Set shortcut</button>
      </form>
      <p role="status">
        {status?.active
          ? `Active: ${status.active}`
          : "No global shortcut active. Use the menu-bar action."}
      </p>
      {(error || status?.error) && <p role="alert">{error || status?.error}</p>}
    </section>
  );
}
