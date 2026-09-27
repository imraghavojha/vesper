import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Disclosure-style popover. Closes on Escape, outside pointer press or when
 * an item calls `close`, and returns focus to its trigger.
 */
export function Popover({
  label,
  trigger,
  triggerClassName,
  placement = "below-end",
  disabled,
  children,
}: {
  label: string;
  trigger: ReactNode;
  triggerClassName?: string;
  placement?: "below-end" | "below-start" | "above-start" | "right-end";
  disabled?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = (restore = true) => {
    setOpen(false);
    if (restore) button.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    panel.current
      ?.querySelector<HTMLElement>(
        "button:not(:disabled), select:not(:disabled), input:not(:disabled)",
      )
      ?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [open]);
  return (
    <div className="popover-root" ref={root}>
      <button
        ref={button}
        type="button"
        className={triggerClassName}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
      </button>
      {open && (
        <div
          ref={panel}
          id={id}
          className={"popover popover--" + placement}
          role="group"
          aria-label={label}
        >
          {children(() => close())}
        </div>
      )}
    </div>
  );
}
