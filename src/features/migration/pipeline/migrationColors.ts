/**
 * The migration screen's surface palette.
 *
 * This used to be a dark navy set, which made the migration screen the only
 * dark island in an otherwise light app. The VALUES are now the light
 * reference-dashboard surfaces; the KEY NAMES are unchanged on purpose —
 * roughly 350 `colors.*` references across MigrationPage and
 * MigrationExtrasPanel resolve through this object, so redefining the values
 * repaints all of them without touching a single call site.
 *
 * Read the names semantically, not literally: `bg.primary` is "the page
 * behind everything", `text.primary` is "the strongest text", and both flipped
 * ends of the scale when the theme went light.
 */
export const migrationColors = {
  bg: {
    primary: '#F7F7F6', // page background
    secondary: '#FFFFFF', // card surface
    card: '#FFFFFF', // nested card surface
    cardHover: '#F7F7F6', // hover wash
  },
  accent: {
    primary: '#2A4954', // Dark Slate Gray — the primary action colour
    secondary: '#2D6079', // Blue-Gray
    success: '#356B43',
    warning: '#A85C13',
    error: '#B03B33',
    info: '#2D6079',
  },
  text: {
    primary: '#272626', // strongest text
    secondary: '#6E6D6B',
    muted: '#767573',
  },
  border: '#E9E9E7',

  /**
   * Tinted fills for pills, tiles and selected rows.
   *
   * Added because the dark theme expressed these inline as
   * `rgba(56, 189, 248, 0.15)` — a translucent wash that reads correctly over
   * navy and washes out to nearly nothing over white. On a light surface these
   * need to be solid tints, so they are named here rather than approximated at
   * each call site.
   */
  soft: {
    primary: '#E4EDEF',
    secondary: '#E7F1F7',
    success: '#EBF5EE',
    warning: '#FFF1E2',
    error: '#FBEAE8',
    info: '#E7F1F7',
    neutral: '#F0F0EE',
  },
} as const;

export type MigrationColors = typeof migrationColors;
