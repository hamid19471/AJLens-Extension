/** Original AJ Lens mark: rounded-square focus frame with a centered lens dot. */
export function LensIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      className="logo"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1" y="1" width="22" height="22" rx="6" fill="#151c1b" stroke="#303a38" />
      <path
        d="M6 9.5V7.5A1.5 1.5 0 0 1 7.5 6h2M14.5 6h2A1.5 1.5 0 0 1 18 7.5v2M18 14.5v2a1.5 1.5 0 0 1-1.5 1.5h-2M9.5 18h-2A1.5 1.5 0 0 1 6 16.5v-2"
        fill="none"
        stroke="#9ed963"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="2.3" fill="#9ed963" />
    </svg>
  );
}
