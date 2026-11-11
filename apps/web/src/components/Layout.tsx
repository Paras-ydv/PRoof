import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, Info, TriangleAlert, X, XCircle } from "lucide-react";
import "./layout.css";

/** Page title row: title, one-line description, and actions on the right. */
export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        {eyebrow && <div className="page-eyebrow">{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

/** A bordered surface for one topic. Header is optional; footer holds secondary actions. */
export function Panel({
  title,
  description,
  actions,
  footer,
  children,
  flush,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  /** No inner padding (for tables and lists that run edge to edge). */
  flush?: boolean;
  id?: string;
}) {
  return (
    <section className="panel" id={id}>
      {(title || actions) && (
        <div className="panel-head">
          <div className="panel-head-text">
            {title && <h2 className="panel-title">{title}</h2>}
            {description && <p className="panel-description">{description}</p>}
          </div>
          {actions && <div className="panel-actions">{actions}</div>}
        </div>
      )}
      <div className={flush ? "panel-body-flush" : "panel-body"}>{children}</div>
      {footer && <div className="panel-foot">{footer}</div>}
    </section>
  );
}

export function Stat({ label, value, sub, trend }: { label: string; value: ReactNode; sub?: ReactNode; trend?: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value tabular">
        {value}
        {trend}
      </div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3 className="empty-title">{title}</h3>
      {children && <p className="empty-text">{children}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function Skeleton({ width = "100%", height = 12, radius }: { width?: number | string; height?: number; radius?: number }) {
  return <span className="skeleton" style={{ width, height, borderRadius: radius }} aria-hidden />;
}

export function Callout({ tone = "info", title, children, action }: { tone?: "info" | "warn" | "fail" | "pass" | "private"; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const icon = tone === "warn" ? <TriangleAlert /> : tone === "fail" ? <XCircle /> : tone === "pass" ? <CheckCircle2 /> : <Info />;
  return (
    <div className={`callout callout-${tone}`} role={tone === "fail" ? "alert" : undefined}>
      <span className="callout-icon">{icon}</span>
      <div className="callout-body">
        {title && <div className="callout-title">{title}</div>}
        {children && <div className="callout-text">{children}</div>}
      </div>
      {action && <div className="callout-action">{action}</div>}
    </div>
  );
}

export function Avatar({ src, name, size = 24, square }: { src?: string | null; name: string; size?: number; square?: boolean }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42), borderRadius: square ? Math.round(size / 4) : "50%" };
  if (!src || failed) {
    return (
      <span className="avatar avatar-fallback" style={style} aria-hidden>
        {name.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return <img className="avatar" src={src} alt="" style={style} onError={() => setFailed(true)} />;
}

/**
 * Modal dialog on the native <dialog> element: focus is trapped and Escape closes it.
 * Used for short tasks that need full attention (add a destination, request a feature).
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="dialog"
      style={{ width: `min(${width}px, calc(100vw - 32px))` }}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="dialog-inner">
        <div className="dialog-head">
          <div>
            <h2 className="dialog-title">{title}</h2>
            {description && <p className="dialog-description">{description}</p>}
          </div>
          <button className="dialog-close" type="button" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </dialog>
  );
}

/* Toasts: short confirmations after an action ("Saved"), and errors that need no decision. */
interface Toast {
  id: number;
  tone: "pass" | "fail" | "info";
  text: string;
}
const ToastContext = createContext<(tone: Toast["tone"], text: string) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast["tone"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "fail" ? 6000 : 3200);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.tone === "pass" ? <CheckCircle2 /> : t.tone === "fail" ? <XCircle /> : <Info />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
