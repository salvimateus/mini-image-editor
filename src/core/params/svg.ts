/** Algorithm constants of the SVG import. */
export const SVG_PARAMS = {
  /** The long side, in px, of an SVG with no width, height or viewBox. */
  defaultSide: 1024,
  /** The smallest long side, in px, of a new document opened from an SVG; a smaller SVG renders larger, with its aspect. */
  minDocumentSide: 1024,
} as const;
