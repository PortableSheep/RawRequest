import { parseLoadConfig } from './load-config';

describe('parser/load-config', () => {
  it('parses key=value pairs and normalizes synonyms', () => {
    const cfg = parseLoadConfig('users=10 iterations=200 duration=30s rps=50');
    expect(cfg['concurrent']).toBe(10);
    expect(cfg['iterations']).toBe(200);
    expect(cfg['duration']).toBe('30s');
    expect(cfg['requestsPerSecond']).toBe(50);
  });

  it('supports quoted values and leaves non-int keys as strings', () => {
    const cfg = parseLoadConfig("waitMin='100ms' waitMax=\"500ms\" adaptive=true");
    expect(cfg['waitMin']).toBe('100ms');
    expect(cfg['waitMax']).toBe('500ms');
    expect(cfg['adaptive']).toBe('true');
  });

  it('returns empty config on empty input', () => {
    expect(parseLoadConfig('')).toEqual({});
    expect(parseLoadConfig('   ')).toEqual({});
  });
});
