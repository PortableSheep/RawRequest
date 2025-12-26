import { parseDurationMs } from './parse-duration';

describe('parse-duration', () => {
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
