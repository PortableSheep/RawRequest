export function parseDurationMs(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Bare numbers are treated as milliseconds for delay-like fields.
    return Math.max(0, value);
  }

  const raw = String(value).trim();
  if (!raw.length) return null;

  // Accept forms like: 250ms, 2s, 1.5m, 1h
  const m = raw.match(/^(-?\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n < 0) return null;
  const unit = (m[2] || 'ms').toLowerCase();
  const mult = unit === 'h' ? 3600000 : unit === 'm' ? 60000 : unit === 's' ? 1000 : 1;
  return Math.round(n * mult);
}
