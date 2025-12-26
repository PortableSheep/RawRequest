export function sleep(ms: number): Promise<void> {
  const safe = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  return new Promise(resolve => setTimeout(resolve, safe));
}
