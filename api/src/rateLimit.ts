/**
 * A small in-memory sliding-window rate limiter, for endpoints with no
 * signed-in user to key on.
 *
 * Deliberately different from the login limiter, which keys on the email
 * address and lives in Postgres. That works because guessing a code means
 * hitting ONE address repeatedly, so a per-address count catches it -- and it
 * must survive restarts, because it is a security control.
 *
 * Enumeration has the opposite shape: many addresses, queried once each. A
 * per-address count never reaches its threshold, so the only thing left to key
 * on is the caller. For an anonymous caller that means the IP address, which is
 * imperfect -- shared NAT puts many real users behind one address, a single
 * IPv6 subscriber holds more addresses than the whole IPv4 internet, and
 * rotating through proxies is cheap.
 *
 * So this is a speed bump, not a guarantee, and it is stored accordingly: in
 * memory, where it is free. Losing the counters on restart matters far less
 * than it would for login, and /api/auth/recognize fires while the user is
 * typing, which makes a database write per call disproportionate.
 */

type Timestamps = number[];

const buckets = new Map<string, Timestamps>();

/**
 * Records a hit and reports whether the caller is over the limit.
 *
 * A sliding window, like the login limiter and for the same reason: a fixed
 * window can be walked straight through its boundary by sending a full
 * allowance either side of it.
 */
export function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;

  const recent = (buckets.get(key) ?? []).filter((at) => at > cutoff);

  if (recent.length >= limit) {
    buckets.set(key, recent); // keep the pruned list; do not record this attempt
    return true;
  }

  recent.push(now);
  buckets.set(key, recent);
  return false;
}

/**
 * Without this the map grows forever: every IP that ever calls leaves an entry
 * behind, so a scan across many addresses becomes a slow memory leak -- the
 * exact traffic this is meant to defend against.
 *
 * unref() so the timer does not hold the process open during shutdown.
 */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
setInterval(() => {
  const cutoff = Date.now() - CLEANUP_INTERVAL_MS;
  for (const [key, timestamps] of buckets) {
    const recent = timestamps.filter((at) => at > cutoff);
    if (recent.length === 0) buckets.delete(key);
    else buckets.set(key, recent);
  }
}, CLEANUP_INTERVAL_MS).unref();
