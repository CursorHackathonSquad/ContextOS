/** Shared with Activity trace rows — neutral system lines. */
export const SURFACE_ACTIVITY_NEUTRAL = "rounded-xl border-0 bg-white/[0.055]";

/** Shared with Activity trace rows — agent-authored lines. */
export const SURFACE_ACTIVITY_AGENT = "rounded-xl border-0 bg-indigo-950/35";

/** Vertical inset only; horizontal flush within CardBody (CardBody still supplies outer px). */
export const SECTION_PAD = "px-0 pb-3 pt-1.5";

/** Results inner panels: same treatment as Activity rows. */
export const SURFACE_RESULTS_BLOCK = `${SURFACE_ACTIVITY_NEUTRAL} ${SECTION_PAD}`;

/** Inset well inside Activity & Results card bodies — behind trace rows / result sections. */
export const SURFACE_CARD_INNER = `rounded-xl border-0 bg-black/[0.22] ${SECTION_PAD}`;
