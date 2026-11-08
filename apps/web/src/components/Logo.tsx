// A simple mark: three stock bars in a rounded square.
export function Logo() {
  return (
    <span className="logo">
      <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" focusable="false" className="logo-mark">
        <rect width="32" height="32" rx="8" className="logo-tile" />
        <rect x="7" y="17" width="4.5" height="8" rx="1.25" className="logo-bar" />
        <rect x="13.75" y="12" width="4.5" height="13" rx="1.25" className="logo-bar" />
        <rect x="20.5" y="7" width="4.5" height="18" rx="1.25" className="logo-bar" />
      </svg>
      <span className="logo-text">Stock Monitor</span>
    </span>
  );
}
