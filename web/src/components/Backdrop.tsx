/**
 * The decorative background: a soft mesh of overlapping colour fields.
 *
 * Built from layered radial gradients rather than an image. A full-bleed raster
 * would weigh a few hundred kilobytes on a checkout page, need a second asset
 * for dark mode, and be fixed at one resolution; this is about a kilobyte of
 * CSS, resolution-independent, and re-themes by swapping variables.
 *
 * Purely presentational, so it is aria-hidden and ignores pointer events -- a
 * screen reader should never announce it, and it must never intercept a click
 * meant for the form on top of it.
 */
export function Backdrop() {
  return <div className="backdrop" aria-hidden="true" />;
}
