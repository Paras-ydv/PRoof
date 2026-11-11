import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link, type LinkProps } from "react-router";
import "./button.css";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

interface Common {
  variant?: Variant;
  size?: Size;
  /** Icon before the label. */
  icon?: ReactNode;
  /** Icon after the label (e.g. an external-link arrow). */
  trailing?: ReactNode;
  loading?: boolean;
}

export type ButtonProps = Common & ButtonHTMLAttributes<HTMLButtonElement>;

function classes(variant: Variant, size: Size, extra?: string) {
  return ["btn", `btn-${variant}`, `btn-${size}`, extra].filter(Boolean).join(" ");
}

function Content({ icon, trailing, loading, children }: Common & { children?: ReactNode }) {
  return (
    <>
      {loading ? <span className="btn-spinner" aria-hidden /> : icon ? <span className="btn-icon">{icon}</span> : null}
      {children !== undefined && <span className="btn-label">{children}</span>}
      {trailing && <span className="btn-icon btn-trailing">{trailing}</span>}
    </>
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, trailing, loading, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={classes(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      <Content icon={icon} trailing={trailing} loading={loading}>
        {children}
      </Content>
    </button>
  );
});

/** A link styled as a button. Internal paths use the router; full URLs open in a new tab. */
export function ButtonLink({
  variant = "secondary",
  size = "md",
  icon,
  trailing,
  className,
  children,
  to,
  ...rest
}: Common & Omit<LinkProps, "to"> & { to: string }) {
  const cls = classes(variant, size, className);
  if (/^https?:\/\//.test(to)) {
    return (
      <a className={cls} href={to} target="_blank" rel="noreferrer">
        <Content icon={icon} trailing={trailing}>
          {children}
        </Content>
      </a>
    );
  }
  return (
    <Link className={cls} to={to} {...rest}>
      <Content icon={icon} trailing={trailing}>
        {children}
      </Content>
    </Link>
  );
}

/** Square button with only an icon. Always needs a label for screen readers. */
export function IconButton({ label, icon, size = "md", variant = "ghost", ...rest }: Omit<ButtonProps, "children"> & { label: string; icon: ReactNode }) {
  return <Button {...rest} variant={variant} size={size} icon={icon} aria-label={label} title={label} className="btn-square" />;
}
