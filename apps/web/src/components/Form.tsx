import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import "./form.css";

/**
 * A labelled control with optional hint and error.
 * The id is generated once and shared by label, control, hint and error,
 * so screen readers announce all of them together.
 */
export function Field({
  label,
  hint,
  error,
  optional,
  children,
  inline,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  /** Label and control side by side (for switches). */
  inline?: boolean;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field${inline ? " field-inline" : ""}`}>
      <div className="field-text">
        <label className="field-label" htmlFor={id}>
          {label}
          {optional && <span className="field-optional">Optional</span>}
        </label>
        {hint && (
          <p className="field-hint" id={hintId}>
            {hint}
          </p>
        )}
      </div>
      <div className="field-control">
        {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
        {error && (
          <p className="field-error" id={errorId} role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

export function Input({ mono, prefix, suffix, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { mono?: boolean; prefix?: ReactNode; suffix?: ReactNode }) {
  if (!prefix && !suffix) return <input className={`input${mono ? " input-mono" : ""} ${className ?? ""}`} {...rest} />;
  return (
    <div className="input input-group">
      {prefix && <span className="input-affix">{prefix}</span>}
      <input className={mono ? "input-mono" : undefined} {...rest} />
      {suffix && <span className="input-affix">{suffix}</span>}
    </div>
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="input textarea" {...props} />;
}

export function Select({ children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="select">
      <select className="input" {...rest}>
        {children}
      </select>
      <ChevronDown className="select-chevron" aria-hidden />
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
  ...rest
}: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; id?: string; "aria-label"?: string; "aria-describedby"?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      {...rest}
    >
      <span className="switch-thumb" />
    </button>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  /** Tone of the selected state, so "Live" and "Shadow" read differently at a glance. */
  tone?: "default" | "private" | "pass" | "muted";
  title?: string;
}

/** A row of mutually exclusive choices. Arrow keys move between options. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
  size = "md",
  label,
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (v: T) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  label: string;
}) {
  const move = (dir: 1 | -1) => {
    const i = options.findIndex((o) => o.value === value);
    const next = options[(i + dir + options.length) % options.length]!;
    onChange(next.value);
  };
  return (
    <div
      className={`segmented segmented-${size}`}
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") (e.preventDefault(), move(1));
        if (e.key === "ArrowLeft" || e.key === "ArrowUp") (e.preventDefault(), move(-1));
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            disabled={disabled}
            title={o.title}
            className={`segment${active ? ` is-active tone-${o.tone ?? "default"}` : ""}`}
            onClick={() => onChange(o.value)}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
