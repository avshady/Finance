/** ARCHITECTURE.md §10: the UI must say this is educational modelling, not SEBI-registered advice. */
export function Disclaimer({ className = '' }: { className?: string }) {
  return (
    <p className={`text-xs leading-relaxed text-muted ${className}`}>
      WealthWise models your numbers to help you plan. It is educational modelling, not
      SEBI-registered investment advice — nothing here is a personalised recommendation from a
      registered adviser. Verify anything consequential before acting on it.
    </p>
  );
}
