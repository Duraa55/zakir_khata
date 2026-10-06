/**
 * The single source of truth for the light theme.
 *
 * COLOUR CARRIES MEANING. Green is money in, red is money out, amber needs
 * attention, ink is "you can press this". Nothing is coloured decoratively — if
 * every card is coloured, none of them says anything. There is deliberately no
 * palette of decorative hues to reach for.
 *
 * Depth comes from tone difference and hairline borders, never from gradients,
 * shadows or glows.
 *
 * Text colours are chosen to clear 4.5:1 on `surface`, because this is read
 * one-handed on cheap Android screens in poor shop light.
 */

export const color = {
  // ── Surfaces ──────────────────────────────────────────────────────────────
  /** Page background. */
  surface: '#FFFFFF',
  /** Raised blocks: hero, tiles, cards. One step of tone, no shadow. */
  surfaceRaised: '#F6F6F7',
  /** Pressed state for a tappable surface. */
  surfacePressed: '#EDEDEF',

  // ── Lines ─────────────────────────────────────────────────────────────────
  /** Hairline between/around blocks. */
  border: '#E6E6E9',
  /** Outlined buttons and rows that must read as interactive. */
  borderStrong: '#D4D4D9',
  /** Outline for a row that needs attention. */
  borderAttention: '#EBC27A',

  // ── Text (three levels, no more) ──────────────────────────────────────────
  textPrimary: '#111113',
  textSecondary: '#66666D',
  textMuted: '#96969E',
  /** On ink-filled surfaces only. */
  textInverse: '#FFFFFF',

  // ── Meaning ───────────────────────────────────────────────────────────────
  /** Money in / received. Dark enough to read as text on white. */
  moneyIn: '#15803D',
  /** Money out / owed by us. */
  moneyOut: '#B91C1C',
  /** Overdue, edited-since-close — things to act on. */
  attention: '#B45309',

  /**
   * Brand cyan. Means BRAND AND INTERACTIVE — filled buttons, active nav, links,
   * the hero surface. It NEVER means money: the moment a colour carries two
   * meanings it carries none.
   *
   * Every value here was measured, not picked by eye. The #00A8D6/#0EA5E9 family
   * only reaches 2.77:1 for white text — unreadable on a cheap screen in poor shop
   * light. This shade clears 6.45:1, and it had to go deeper still than a first
   * pass at #0077A8: the translucent button sitting ON the fill lightens it, and
   * at #0077A8 that button's white label fell to 3.66:1.
   */
  brand: '#00658F',
  /** The deeper gradient stop — 8.98:1, so white holds the whole way down. */
  brandDeep: '#004E73',

  /** On the brand fill only. Each verified against BOTH gradient stops. */
  onBrand: '#FFFFFF',
  /** Secondary label on brand: 4.73:1 at the lightest point. */
  onBrandMuted: 'rgba(255,255,255,0.80)',
  /** Translucent button fill. 0.14 is the ceiling — 0.18 drops its label to 4.11:1. */
  onBrandFill: 'rgba(255,255,255,0.14)',
  onBrandBorder: 'rgba(255,255,255,0.30)',

  /** Dimmed backdrop behind a modal sheet. Tone only — no colour meaning. */
  scrim: 'rgba(17,17,19,0.45)',
  /** Near-black behind a full-screen photo, so the image reads edge to edge. */
  scrimPhoto: 'rgba(17,17,19,0.92)',

  /** The one interactive accent. Ink stays for text, cyan carries interaction. */
  accent: '#00658F',
  accentPressed: '#004E73',
} as const;

/**
 * The only gradient in the app, and it belongs to the hero card alone. One
 * gradient reads as deliberate; three read as decorated. Everything else —
 * tiles, rows, nav, cards, buttons — is flat, with no shadow or glow anywhere.
 */
export const brandGradient = [color.brand, color.brandDeep] as const;

/** 4px base. Whitespace does the grouping, not boxes. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

/**
 * Two weights only. Heavy weight at phone sizes is what reads cheap, so there is
 * no 600/700/800 here to reach for.
 */
export const weight = {
  regular: '400',
  medium: '500',
} as const;

/**
 * Sentence case everywhere — no ALL CAPS, no textTransform.
 * Sizes are fixed but containers must never be: Urdu runs ~40% longer than
 * English, so every label needs room to grow.
 */
export const type = {
  /** The one figure that dominates the screen. */
  hero: { fontSize: 34, fontWeight: weight.medium, letterSpacing: -0.6 },
  title: { fontSize: 20, fontWeight: weight.medium, letterSpacing: -0.2 },
  heading: { fontSize: 16, fontWeight: weight.medium },
  body: { fontSize: 15, fontWeight: weight.regular },
  bodyMedium: { fontSize: 15, fontWeight: weight.medium },
  label: { fontSize: 13, fontWeight: weight.regular },
  caption: { fontSize: 12, fontWeight: weight.regular },
} as const;

/** Hairline that survives Android's rounding. */
export const hairline = 1;

/** Used one-handed, in a hurry. Nothing tappable goes below this. */
export const touchTarget = 44;

/**
 * CHROME DENSITY — the list is the product; everything above it is supporting.
 *
 * Screens take their padding from here instead of hand-tuning, so tightening the app
 * is one edit, not thirty. Chrome shrinks; content never does: an amount, an entry
 * label and a touch target keep their size, and `touchTarget` above is the floor.
 */
export const chrome = {
  /** Summary / hero cards: padding and the margins around them. */
  cardPadY: space.sm,
  cardMarginY: space.xs,
  /** Entry rows — with minHeight: touchTarget, this stays tappable while reading dense. */
  rowPadY: space.sm,
  rowGap: space.xs,
  /** Day headers are separators, not content. */
  dayPadY: space.xs,
  /** A one-line bar: filters collapsed, the offline notice, a compact toolbar. */
  barMinHeight: 40,
  barPadY: space.xs,
  /** Floating action button — a full-width bar costs a whole entry row. */
  fab: 52,
  /** Room under a list so the floating button never covers the last row. */
  listBottom: 88,
} as const;

/** Standard outline icon sizes, so weight stays consistent across screens. */
export const iconSize = {
  sm: 16,
  md: 20,
  lg: 24,
} as const;

export const tokens = { color, brandGradient, space, radius, weight, type, hairline, touchTarget, iconSize };
export default tokens;
