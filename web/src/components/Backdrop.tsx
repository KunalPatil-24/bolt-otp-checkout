/**
 * The decorative background: soft angular ribbons, echoing the bolt motif.
 *
 * Purely presentational, so it is aria-hidden and ignores pointer events -- a
 * screen reader should never announce it, and it must never intercept a click
 * meant for the form sitting on top of it.
 *
 * Drawn as stroked polylines rather than filled polygons: a thick stroke with a
 * mitred join produces the sharp angular ribbon shape from one short list of
 * points, and the width is a single number to tune rather than a second edge to
 * keep parallel by hand.
 *
 * It is one fixed element behind everything rather than a background-image on
 * the body, so it does not scroll with the page or repeat.
 */
export function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <svg
        viewBox="0 0 1440 900"
        // slice fills the viewport at any aspect ratio, cropping rather than
        // letterboxing, so there is never a bare strip at the edge.
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="bolt-ribbon-a" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--backdrop-from)" />
            <stop offset="55%" stopColor="var(--backdrop-mid)" />
            <stop offset="100%" stopColor="var(--backdrop-to)" />
          </linearGradient>
          <linearGradient id="bolt-ribbon-b" x1="1" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--backdrop-mid)" />
            <stop offset="100%" stopColor="var(--backdrop-to)" />
          </linearGradient>
        </defs>

        {/* Descending bolt across the left two-thirds. */}
        <polyline
          points="-120,40 300,610 470,395 900,1000"
          fill="none"
          stroke="url(#bolt-ribbon-a)"
          strokeWidth="165"
          strokeLinejoin="miter"
        />

        {/* A rising peak on the right, to balance it. */}
        <polyline
          points="1080,980 1360,300 1620,820"
          fill="none"
          stroke="url(#bolt-ribbon-b)"
          strokeWidth="140"
          strokeLinejoin="miter"
        />
      </svg>
    </div>
  );
}
