/** The two-node handoff mark used by the mode's launch card. */
export function OrchestrationGlyph() {
  return (
    <svg width="128" height="96" viewBox="0 0 128 96" aria-hidden="true" focusable="false">
      <rect x="7" y="14" width="45" height="30" rx="8" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="76" y="52" width="45" height="30" rx="8" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M52 29 C67 29 61 67 76 67" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M76 67 C61 67 67 29 52 29" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3 3" />
      <circle cx="52" cy="29" r="2.4" fill="currentColor" />
      <circle cx="76" cy="67" r="2.4" fill="currentColor" />
    </svg>
  )
}
