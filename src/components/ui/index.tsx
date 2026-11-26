import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Info, X } from "lucide-react";
import type { MetricValue } from "@/types";
import { formatNumber } from "@/services/format";

type ButtonVariant = "primary" | "secondary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "md" | "sm";
  icon?: LucideIcon;
  iconOnly?: boolean;
}

export function Button({ variant = "secondary", size = "md", icon: Icon, iconOnly, className = "", children, ...rest }: ButtonProps) {
  const cls = ["btn", `btn--${variant}`, size === "sm" && "btn--sm", iconOnly && "btn--icon", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" className={cls} {...rest}>
      {Icon && <Icon size={size === "sm" ? 14 : 16} strokeWidth={2} />}
      {!iconOnly && children}
    </button>
  );
}

export function Card({ title, subtitle, actions, children, flush, className = "" }: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={`card ${flush ? "card--flush" : ""} ${className}`}>
      {(title || actions) && (
        <header className="card__header" style={flush ? { padding: "var(--space-5) var(--space-5) 0" } : undefined}>
          <div>
            {title && <h3 className="card__title">{title}</h3>}
            {subtitle && <p className="card__subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: MetricValue | number; hint?: string }) {
  const v: MetricValue = typeof value === "number" ? { kind: "value", value } : value;
  return (
    <div className="card">
      <div className="stat__label">{label}</div>
      {v.kind === "value" ? (
        <div className="stat__value">{formatNumber(v.value)}</div>
      ) : (
        <div className="stat__value stat__value--na">Недоступно через API</div>
      )}
      {hint && <div className="stat__hint">{hint}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, text, action }: { icon: LucideIcon; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__icon">
        <Icon size={22} />
      </div>
      <div className="empty__title">{title}</div>
      {text && <div className="empty__text">{text}</div>}
      {action}
    </div>
  );
}

export function Notice({ children, icon: Icon = Info }: { children: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="notice">
      <Icon size={16} />
      <div>{children}</div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className={o.value === value ? "is-active" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function StatusBadge({ on, label }: { on: boolean; label: string }) {
  return (
    <span className="badge">
      <span className={`dot ${on ? "dot--on" : ""}`} />
      {label}
    </span>
  );
}

export function Modal({ title, onClose, children, footer, width = 560 }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width }} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal__header">
          <h3>{title}</h3>
          <button type="button" className="btn btn--ghost btn--sm btn--icon" onClick={onClose} aria-label="Закрыть">
            <X size={16} />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__footer">{footer}</footer>}
      </div>
    </div>
  );
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const indeterminate = value < 0;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className={`progress ${indeterminate ? "progress--indeterminate" : ""}`}>
        <div className="progress__bar" style={indeterminate ? undefined : { width: `${Math.round(Math.min(1, value) * 100)}%` }} />
      </div>
      {label !== undefined && (
        <div className="row small muted">
          <span>{label}</span>
          <span className="spacer" />
          {!indeterminate && <span className="mono">{Math.round(Math.min(1, value) * 100)}%</span>}
        </div>
      )}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={`toggle ${disabled ? "is-disabled" : ""}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle__track" aria-hidden="true">
        <span className="toggle__thumb" />
      </span>
      <span>{label}</span>
    </label>
  );
}

export function ErrorNotice({ error, onClose }: { error: string | null | undefined; onClose?: () => void }) {
  if (!error) return null;
  return (
    <div className="notice notice--error">
      <AlertTriangle size={16} />
      <div style={{ whiteSpace: "pre-wrap", flex: 1 }}>{error}</div>
      {onClose && (
        <button type="button" className="btn btn--ghost btn--sm btn--icon" onClick={onClose} aria-label="Скрыть">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export function Metric({ label, value, format }: { label: string; value: number | null | undefined; format?: (n: number) => string }) {
  return (
    <div className="metric">
      <div className="stat__label">{label}</div>
      {value === null || value === undefined ? (
        <div className="metric__na">Недоступно через API</div>
      ) : (
        <div className="metric__value">{format ? format(value) : formatNumber(value)}</div>
      )}
    </div>
  );
}
