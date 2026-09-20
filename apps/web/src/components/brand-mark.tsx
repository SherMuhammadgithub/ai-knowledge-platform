// The product in one glyph: a document page with one highlighted line, the same highlight a
// citation puts on the passage an answer came from. Colors come from tokens, so it follows the theme.
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="3.5" y="2.5" width="17" height="19" rx="3" stroke="currentColor" strokeWidth="1.75" />
      <rect x="7" y="8" width="10" height="3.5" rx="1" className="fill-cite" />
      <path
        d="M7 5.75h5M7 14.5h10M7 17.75h6.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
