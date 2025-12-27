import { normalizeLoadTestConfig, parseDurationMs } from './load-test-config';

describe('load-test-config', () => {
  it('defaults iterations when no stop condition is provided', () => {
    const normalized = normalizeLoadTestConfig({});
    expect(normalized.iterations).toBe(10);
    expect(normalized.durationMs).toBeNull();
  });

  it('parses duration, users, ramp, and delays', () => {
    const normalized = normalizeLoadTestConfig({
      duration: '2s',
      startUsers: 2,
      maxUsers: 5,
      rampUp: '1s',
      delay: '10ms',
      waitMin: '1s',
      waitMax: '2s',
      requestsPerSecond: 50,
    });

    expect(normalized.durationMs).toBe(2000);
    expect(normalized.iterations).toBeNull();
    expect(normalized.startUsers).toBe(2);
    expect(normalized.maxUsers).toBe(5);
    expect(normalized.rampUpMs).toBe(1000);
    expect(normalized.delayMs).toBe(10);
    expect(normalized.waitMinMs).toBe(1000);
    expect(normalized.waitMaxMs).toBe(2000);
    expect(normalized.requestsPerSecond).toBe(50);
  });

  it('clamps start users to max users and normalizes failure rate threshold', () => {
    const normalized = normalizeLoadTestConfig({
      startUsers: 10,
      maxUsers: 3,
      failureRateThreshold: '5%',
    });

    expect(normalized.startUsers).toBe(3);
    expect(normalized.maxUsers).toBe(3);
    expect(normalized.failureRateThreshold).toBeCloseTo(0.05);
  });

  it('enables adaptive mode with sensible defaults', () => {
    const normalized = normalizeLoadTestConfig({
      adaptive: true,
    });

    expect(normalized.adaptiveEnabled).toBe(true);
    expect(normalized.adaptiveFailureRate).toBeCloseTo(0.01);
    expect(normalized.adaptiveWindowSec).toBe(15);
    expect(normalized.adaptiveStableSec).toBe(20);
    expect(normalized.adaptiveCooldownMs).toBe(5000);
    expect(normalized.adaptiveBackoffStepUsers).toBe(2);
  });
});

describe('parseDurationMs', () => {
  it('parses numbers as milliseconds', () => {
    expect(parseDurationMs(0)).toBe(0);
    expect(parseDurationMs(12)).toBe(12);
    expect(parseDurationMs(-1)).toBe(0);
  });

  it('parses unit strings', () => {
    expect(parseDurationMs('250ms')).toBe(250);
    expect(parseDurationMs('2s')).toBe(2000);
    expect(parseDurationMs('1.5m')).toBe(90_000);
    expect(parseDurationMs('1h')).toBe(3_600_000);
  });

  it('defaults to ms when no unit is provided', () => {
    expect(parseDurationMs('15')).toBe(15);
    expect(parseDurationMs(' 15 ')).toBe(15);
  });

  it('rejects invalid/negative values', () => {
    expect(parseDurationMs(null)).toBeNull();
    expect(parseDurationMs(undefined)).toBeNull();
    expect(parseDurationMs('')).toBeNull();
    expect(parseDurationMs('wat')).toBeNull();
    expect(parseDurationMs('-1s')).toBeNull();
  });
});
