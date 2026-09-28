import { format, formatCompactINR, formatShort, type Paise } from '@/lib/core/domain/money';

type Variant = 'full' | 'short' | 'compact';

interface CurrencyTextProps {
  amount: Paise;
  variant?: Variant;
  /** Colour the text green/red based on sign. Off by default (most figures are neutral). */
  signColor?: boolean;
  className?: string;
}

/** Never do money maths inline — this is the one place amounts get formatted. */
export function CurrencyText({ amount, variant = 'short', signColor = false, className = '' }: CurrencyTextProps) {
  const text =
    variant === 'full' ? format(amount) : variant === 'compact' ? formatCompactINR(amount) : formatShort(amount);

  const colorClass = signColor ? (amount > 0 ? 'text-positive' : amount < 0 ? 'text-negative' : '') : '';

  return <span className={`tabular-nums ${colorClass} ${className}`}>{text}</span>;
}
