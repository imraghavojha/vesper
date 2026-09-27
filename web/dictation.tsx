import { useEffect, useRef, useState } from "react";
import type { SpeechStatus } from "../shared/desktop.js";
import { MicIcon } from "./presentation/icons.js";

export function Dictation({
  disabled,
  onInsert,
}: {
  disabled: boolean;
  onInsert: (text: string) => Promise<void>;
}) {
  const bridge = window.vesperDesktop;
  const [status, setStatus] = useState<SpeechStatus | null>(null);
  const [phase, setPhase] = useState<
    "idle" | "starting" | "recording" | "stopping" | "cancelling" | "uncertain"
  >("idle");
  const [text, setText] = useState("");
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const current = useRef<{
    sessionId: string;
    text: string;
    cancelled: boolean;
  } | null>(null);
  const insert = useRef(onInsert);
  insert.current = onInsert;
  useEffect(() => {
    if (!bridge) return;
    const remove = bridge.onSpeechEvent((event) => {
      if (event.type === "status" && event.status) setStatus(event.status);
      if (event.type === "error")
        setError(event.message ?? "Voice input is unavailable.");
      const capture = current.current;
      if (!capture || event.sessionId !== capture.sessionId) return;
      if (event.type === "error") setPhase("uncertain");
      if (event.type === "started") setPhase("recording");
      if (event.type === "transcript" && !capture.cancelled) {
        capture.text = event.text ?? "";
        setText(capture.text);
      }
      if (event.type === "stopped") {
        current.current = null;
        setDiscarding(false);
        setPhase("idle");
        setText("");
        if (
          !capture.cancelled &&
          event.final === true &&
          event.reason !== "cancelled" &&
          event.reason !== "helper-exited" &&
          capture.text.trim()
        )
          void insert.current(capture.text).catch(() => {
            setText(capture.text);
            setError(
              "This transcript does not fit in the draft. Shorten the draft, then add the transcript below.",
            );
          });
      }
    });
    return () => {
      remove();
      if (current.current) {
        current.current.cancelled = true;
        void bridge.cancelSpeech().catch(() => {});
      }
    };
  }, [bridge]);
  if (!bridge) return null;
  async function command(
    operation: "status" | "prepare" | "start" | "stop" | "cancel",
  ) {
    if (!bridge) return;
    setError("");
    if (operation === "start") {
      setDiscarding(false);
      current.current = {
        sessionId: crypto.randomUUID(),
        text: "",
        cancelled: false,
      };
      setPhase("starting");
    }
    if (operation === "stop") setPhase("stopping");
    if (operation === "cancel" && current.current) {
      current.current.cancelled = true;
      setDiscarding(true);
      setPhase("cancelling");
    }
    const capture = current.current;
    try {
      if (operation === "cancel") {
        await bridge.cancelSpeech();
        if (current.current === capture) {
          current.current = null;
          setPhase("idle");
          setText("");
        }
        return;
      }
      await bridge.speechCommand({
        id: crypto.randomUUID(),
        command: operation,
        locale: "en-US",
        ...(["start", "stop", "cancel"].includes(operation) && current.current
          ? { sessionId: current.current.sessionId }
          : {}),
      });
    } catch {
      if (
        ["start", "stop", "cancel"].includes(operation) &&
        current.current !== capture
      )
        return;
      setError(
        "Voice input could not start or stop. Check availability and any recording in another window.",
      );
      if (operation === "start") {
        current.current = null;
        setPhase("idle");
      } else if (
        (operation === "stop" || operation === "cancel") &&
        current.current
      ) {
        setPhase("uncertain");
        setError(
          "Recording may still be active. Retry Cancel to confirm it has stopped.",
        );
      }
    }
  }
  const ready = !!status?.available && status.assets === "ready";
  const statusText = status
    ? status.available
      ? `On-device · ${status.assets} · microphone ${status.microphone}`
      : "On-device speech is unavailable on this Mac."
    : "Voice creates a private draft. It never sends automatically.";
  const panelVisible = open || phase !== "idle" || !!text || !!error;
  return (
    <div className="dictation-root">
      <button
        type="button"
        className={
          "composer-icon dictation-trigger" +
          (phase === "recording" ? " recording" : "")
        }
        aria-label={
          phase === "idle"
            ? ready
              ? "Start voice input"
              : "Voice input options"
            : "Voice input in progress"
        }
        title={phase === "idle" ? statusText : "Voice input in progress"}
        aria-expanded={panelVisible}
        aria-pressed={phase === "recording" ? true : undefined}
        disabled={disabled && phase === "idle"}
        onClick={() => {
          if (phase === "idle" && ready && !open) void command("start");
          else setOpen((value) => (phase === "idle" ? !value : true));
        }}
      >
        <MicIcon size={20} />
      </button>
      {panelVisible && (
        <section
          className="dictation"
          aria-label="Voice input"
          onKeyDown={(event) => {
            if (event.key === "Escape" && phase === "idle" && !text) {
              event.stopPropagation();
              setOpen(false);
              setError("");
            }
          }}
        >
      {phase === "idle" ? (
        <>
          <span className="dictation-status">{statusText}</span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => void command("status")}
          >
            Check voice
          </button>
          {status?.available && status.assets !== "ready" && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => void command("prepare")}
            >
              Prepare on-device voice
            </button>
          )}
          <button
            type="button"
            disabled={
              disabled || !status?.available || status.assets !== "ready"
            }
            onClick={() => void command("start")}
          >
            Record voice
          </button>
          <button
            type="button"
            className="dictation-dismiss"
            onClick={() => {
              setOpen(false);
              setError("");
            }}
            disabled={!!text}
          >
            Done
          </button>
        </>
      ) : (
        <>
          <span role="status">
            {phase === "uncertain"
              ? "Recording status unconfirmed"
              : phase === "recording"
                ? "Microphone recording"
                : phase === "starting"
                  ? "Starting microphone…"
                  : phase === "stopping"
                    ? "Stopping and finalizing…"
                    : "Cancelling microphone…"}
          </span>
          <button
            type="button"
            disabled={
              (phase !== "recording" && phase !== "uncertain") || discarding
            }
            onClick={() => void command("stop")}
          >
            Stop and use transcript
          </button>
          <button
            type="button"
            disabled={phase === "cancelling"}
            onClick={() => void command("cancel")}
          >
            Cancel recording
          </button>
        </>
      )}
      {text && <p className="dictation-preview">{text}</p>}
      {phase === "idle" && text && (
        <button
          type="button"
          onClick={() =>
            void insert
              .current(text)
              .then(() => {
                setText("");
                setError("");
              })
              .catch(() =>
                setError("The transcript still does not fit in this draft."),
              )
          }
        >
          Add transcript to draft
        </button>
      )}
      {error && (
        <p className="dictation-error" role="alert">
          {error}
        </p>
      )}
        </section>
      )}
    </div>
  );
}
