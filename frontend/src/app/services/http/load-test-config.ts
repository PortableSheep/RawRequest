import { parseDurationMs } from './parse-duration';

export type NormalizedLoadTestConfig = {
  iterations: number | null;
  durationMs: number | null;
  startUsers: number;
  maxUsers: number;
  spawnRate: number | null;
  rampUpMs: number | null;
  delayMs: number;
  waitMinMs: number | null;
  waitMaxMs: number | null;
  requestsPerSecond: number | null;
  failureRateThreshold: number | null; // fraction 0..1

  adaptiveEnabled: boolean;
  adaptiveFailureRate: number | null; // fraction 0..1
  adaptiveWindowSec: number;
  adaptiveStableSec: number;
  adaptiveCooldownMs: number;
  adaptiveBackoffStepUsers: number;
};

export function normalizeLoadTestConfig(config: any): NormalizedLoadTestConfig {
  const toInt = (v: any): number | null => {
    const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
    if (!Number.isFinite(n)) return null;
    return Math.trunc(n);
  };

  const iterations = toInt(config?.iterations);
  const durationMs = parseDurationMs(config?.duration);

  const concurrent = toInt(config?.concurrent);
  const users = toInt(config?.users);
  const start = toInt(config?.start);
  const startUsers = toInt(config?.startUsers);
  const max = toInt(config?.max);
  const maxUsers = toInt(config?.maxUsers);

  const startU = Math.max(0, startUsers ?? start ?? concurrent ?? users ?? 1);
  const maxU = Math.max(1, maxUsers ?? max ?? concurrent ?? users ?? 1);
  const normalizedStartUsers = Math.min(startU, maxU);

  const spawnRate = toInt(config?.spawnRate);
  const rampUpMs = parseDurationMs(config?.rampUp);

  const delayMs = parseDurationMs(config?.delay) ?? 0;
  const waitMinMs = parseDurationMs(config?.waitMin);
  const waitMaxMs = parseDurationMs(config?.waitMax);

  const rps = toInt(config?.requestsPerSecond);

  const parseFailureRateThreshold = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
      const frac = value > 1 ? value / 100 : value;
      return Math.min(1, Math.max(0, frac));
    }
    const s = String(value).trim();
    if (!s) return null;
    const percent = s.match(/^(-?\d+(?:\.\d+)?)\s*%$/);
    if (percent) {
      const p = parseFloat(percent[1]);
      if (!Number.isFinite(p) || p < 0) return null;
      return Math.min(1, Math.max(0, p / 100));
    }
    const n = parseFloat(s);
    if (!Number.isFinite(n) || n < 0) return null;
    const frac = n > 1 ? n / 100 : n;
    return Math.min(1, Math.max(0, frac));
  };

  const failureRateThreshold = parseFailureRateThreshold(config?.failureRateThreshold);

  const parseBool = (value: unknown): boolean => {
    if (value === true) return true;
    if (value === false) return false;
    if (typeof value === 'number') return value !== 0;
    const s = String(value ?? '').trim().toLowerCase();
    if (!s) return false;
    return ['1', 'true', 'yes', 'y', 'on', 'enable', 'enabled'].includes(s);
  };

  const adaptiveEnabled = parseBool(config?.adaptive);
  const adaptiveFailureRateRaw = parseFailureRateThreshold(config?.adaptiveFailureRate);
  const adaptiveFailureRate = adaptiveEnabled
    ? (adaptiveFailureRateRaw ?? 0.01)
    : null;

  const parseSeconds = (value: unknown, fallbackSec: number): number => {
    const ms = parseDurationMs(value);
    if (ms !== null && ms > 0) {
      return Math.max(1, Math.round(ms / 1000));
    }
    const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
    if (Number.isFinite(n) && n > 0) {
      return Math.max(1, Math.trunc(n));
    }
    return fallbackSec;
  };

  const adaptiveWindowSec = parseSeconds(config?.adaptiveWindow, 15);
  const adaptiveStableSec = parseSeconds(config?.adaptiveStable, 20);
  const adaptiveCooldownMs = parseSeconds(config?.adaptiveCooldown, 5) * 1000;
  const adaptiveBackoffStepUsers = Math.max(1, toInt(config?.adaptiveBackoffStep) ?? 2);

  let normalizedIterations = iterations && iterations > 0 ? iterations : null;
  const normalizedDurationMs = durationMs && durationMs > 0 ? durationMs : null;
  if (normalizedIterations === null && normalizedDurationMs === null) {
    normalizedIterations = 10;
  }

  return {
    iterations: normalizedIterations,
    durationMs: normalizedDurationMs,
    startUsers: normalizedStartUsers,
    maxUsers: maxU,
    spawnRate: spawnRate && spawnRate > 0 ? spawnRate : null,
    rampUpMs: rampUpMs && rampUpMs > 0 ? rampUpMs : null,
    delayMs: Math.max(0, delayMs),
    waitMinMs: waitMinMs !== null ? Math.max(0, waitMinMs) : null,
    waitMaxMs: waitMaxMs !== null ? Math.max(0, waitMaxMs) : null,
    requestsPerSecond: rps && rps > 0 ? rps : null,
    failureRateThreshold,

    adaptiveEnabled,
    adaptiveFailureRate,
    adaptiveWindowSec,
    adaptiveStableSec,
    adaptiveCooldownMs,
    adaptiveBackoffStepUsers,
  };
}
