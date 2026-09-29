import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

interface FieldProps {
  label: string;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
}

/** Label + optional "why this matters" hint, wrapping any input. */
export function Field({ label, hint, children, htmlFor }: FieldProps) {
  return (
    <label htmlFor={htmlFor} className="mb-3 block text-sm">
      <span className="mb-1 block font-medium text-foreground">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

const baseInputClass =
  'w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-50';

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props;
  return <input className={`${baseInputClass} ${className}`} {...rest} />;
}

export function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = '', ...rest } = props;
  return <select className={`${baseInputClass} ${className}`} {...rest} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = '', ...rest } = props;
  return <textarea className={`${baseInputClass} ${className}`} {...rest} />;
}

export function Button({
  variant = 'primary',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  const variantClass: Record<string, string> = {
    primary: 'bg-primary text-primary-foreground hover:opacity-90',
    secondary: 'border border-border bg-surface text-foreground hover:bg-surface-raised',
    ghost: 'text-muted hover:text-foreground',
    // Destructive stays red rather than black. In an app with a "delete all data"
    // button, colour is the warning, and flattening it into the primary style would
    // remove the one signal that distinguishes it at a glance.
    danger: 'bg-negative text-primary-foreground hover:opacity-90',
  };
  return (
    <button
      className={`inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none ${variantClass[variant]} ${className}`}
      {...rest}
    />
  );
}
