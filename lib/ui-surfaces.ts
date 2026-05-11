/** Shared with Agent map tiles and Results inner panels — light lift on dark UI. */
export const SURFACE_ACTIVITY_NEUTRAL = "rounded-xl border-0 bg-white/[0.055]";

/** Shared with Agent map — agent-tinted panel. */
export const SURFACE_ACTIVITY_AGENT = "rounded-xl border-0 bg-indigo-950/35";

/** Vertical inset only; horizontal flush where parent supplies inset. */
export const SECTION_PAD = "px-3 py-2";

/** Horizontal inset for inner well + nested shells inside Activity / Results. */
export const INNER_PAD_X = "sm:px-4";

/** Results inner panels: same treatment as Agent map neutral rows. */
export const SURFACE_RESULTS_BLOCK = `${SURFACE_ACTIVITY_NEUTRAL} ${SECTION_PAD}`;

/** Inset well inside Activity & Results card bodies — behind trace rows / result sections. */
export const SURFACE_CARD_INNER = `rounded-xl border-0 bg-black/[0.22] ${INNER_PAD_X}`;

/**
 * Activity log trace rows — dark grey a step above page bg (zinc-950), same padding via SECTION_PAD.
 */
export const SURFACE_ACTIVITY_TRACE_NEUTRAL =
  "rounded-xl bg-white/[0.03]";

export const SURFACE_ACTIVITY_TRACE_AGENT = "rounded-xl bg-white/[0.03]";
