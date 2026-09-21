export function formatTime(seconds: number | null) {
  if (seconds === null) return "Elapsed";
  const safe = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

export function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return message ? (
    <div className="error-banner" role="alert">
      <span>{message}</span>
      <button type="button" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  ) : null;
}

export function Overlay({
  title,
  onClose,
  children,
  className = "",
  style,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className="overlay-backdrop">
      <section
        className={`tool-overlay ${className}`}
        style={style}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
