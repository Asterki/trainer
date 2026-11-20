/** Flat barbell mark used by the rail, the top bar and empty states. */

interface BrandMarkProps {
  className?: string;
}

export function BrandMark({ className }: BrandMarkProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3" y="22" width="42" height="4" rx="2" fill="currentColor" />
      <rect x="7" y="15" width="4" height="18" rx="1.6" fill="currentColor" />
      <rect x="37" y="15" width="4" height="18" rx="1.6" fill="currentColor" />
      <rect x="13" y="11" width="5" height="26" rx="2" fill="currentColor" />
      <rect x="30" y="11" width="5" height="26" rx="2" fill="currentColor" />
    </svg>
  );
}
