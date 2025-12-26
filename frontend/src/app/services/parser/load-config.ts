export type LoadConfig = Record<string, any>;

export function parseLoadConfig(configStr: string): LoadConfig {
  const config: LoadConfig = {};
  const source = (configStr || '').trim();
  if (!source.length) {
    return config;
  }

  const normalizeKey = (raw: string): string => {
    const k = (raw || '').trim().toLowerCase();
    const map: Record<string, string> = {
      // concurrency
      concurrency: 'concurrent',
      concurrent: 'concurrent',
      users: 'concurrent',
      user: 'concurrent',
      u: 'concurrent',

      // total work
      amount: 'iterations',
      requests: 'iterations',
      requestcount: 'iterations',
      iterations: 'iterations',
      count: 'iterations',

      // runtime
      runtime: 'duration',
      duration: 'duration',
      time: 'duration',

      // pacing
      delay: 'delay',
      wait: 'delay',
      waittime: 'delay',
      thinktime: 'delay',
      minwait: 'waitMin',
      waitmin: 'waitMin',
      maxwait: 'waitMax',
      waitmax: 'waitMax',

      // ramp
      ramp: 'rampUp',
      rampup: 'rampUp',
      spawnrate: 'spawnRate',
      spawn_rate: 'spawnRate',
      r: 'spawnRate',

      // users range
      start: 'start',
      startusers: 'startUsers',
      max: 'max',
      maxusers: 'maxUsers',

      // global throttle
      rps: 'requestsPerSecond',
      requestspersecond: 'requestsPerSecond',

      // early abort
      failureratethreshold: 'failureRateThreshold',
      failurethreshold: 'failureRateThreshold',
      failthreshold: 'failureRateThreshold',
      failrate: 'failureRateThreshold',
      maxfailurerate: 'failureRateThreshold',
      maxfailure: 'failureRateThreshold',
      failpct: 'failureRateThreshold',
      failurepct: 'failureRateThreshold',

      // adaptive backoff
      adaptive: 'adaptive',
      autobackoff: 'adaptive',
      autoadjust: 'adaptive',
      autotune: 'adaptive',
      backoff: 'adaptive',
      stablebackoff: 'adaptive',

      adaptivefailurerate: 'adaptiveFailureRate',
      adaptivefailrate: 'adaptiveFailureRate',
      adaptivefailure: 'adaptiveFailureRate',
      adaptivefailurethreshold: 'adaptiveFailureRate',
      adaptive_threshold: 'adaptiveFailureRate',

      adaptivewindow: 'adaptiveWindow',
      window: 'adaptiveWindow',
      windowsec: 'adaptiveWindow',
      windows: 'adaptiveWindow',

      adaptivestable: 'adaptiveStable',
      stablesec: 'adaptiveStable',
      stablefor: 'adaptiveStable',
      stable: 'adaptiveStable',

      adaptivecooldown: 'adaptiveCooldown',
      cooldown: 'adaptiveCooldown',

      adaptivebackoffstep: 'adaptiveBackoffStep',
      backoffstep: 'adaptiveBackoffStep',
      backoffusers: 'adaptiveBackoffStep',
    };
    return map[k] || raw.trim();
  };

  const shouldParseInt = (key: string): boolean => {
    return [
      'concurrent',
      'iterations',
      'start',
      'max',
      'spawnRate',
      'requestsPerSecond',
      'adaptiveBackoffStep',
    ].includes(key);
  };

  const pairRx = /([A-Za-z_][\w-]*)\s*=\s*("[^"]*"|'[^']*'|[^\s,]+)\s*(?:,|\s|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pairRx.exec(source)) !== null) {
    const rawKey = match[1];
    let rawValue = match[2] ?? '';
    rawValue = rawValue.trim();
    if (
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
    ) {
      rawValue = rawValue.substring(1, rawValue.length - 1);
    }

    const key = normalizeKey(rawKey);
    if (shouldParseInt(key)) {
      const n = parseInt(rawValue, 10);
      if (!isNaN(n)) {
        config[key] = n;
      } else {
        config[key] = rawValue;
      }
    } else {
      config[key] = rawValue;
    }
  }

  return config;
}
