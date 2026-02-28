import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const args = {
    statsPath: 'dist/stats.json',
    outPath: 'dist/perf-baseline-summary.json',
    topN: 15,
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if ((token === '--stats' || token === '-s') && argv[i + 1]) {
      args.statsPath = argv[++i];
      continue;
    }
    if ((token === '--out' || token === '-o') && argv[i + 1]) {
      args.outPath = argv[++i];
      continue;
    }
    if ((token === '--top' || token === '-t') && argv[i + 1]) {
      const n = Number.parseInt(argv[++i], 10);
      if (Number.isFinite(n) && n > 0) {
        args.topN = n;
      }
    }
  }
  return args;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 B';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB'];
  let value = bytes;
  let unit = -1;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(2)} ${units[unit]}`;
}

function packageKeyFromInputPath(inputPath) {
  if (typeof inputPath !== 'string' || !inputPath.length) {
    return '<unknown>';
  }
  if (inputPath.startsWith('node_modules/')) {
    const rel = inputPath.slice('node_modules/'.length);
    const parts = rel.split('/');
    if (parts[0]?.startsWith('@') && parts[1]) {
      return `${parts[0]}/${parts[1]}`;
    }
    return parts[0] || '<unknown>';
  }
  if (inputPath.startsWith('src/')) {
    return '<app-src>';
  }
  return '<other>';
}

function topEntries(items, topN) {
  return items.sort((a, b) => b.bytes - a.bytes).slice(0, topN);
}

async function main() {
  const { statsPath, outPath, topN } = parseArgs(process.argv.slice(2));
  const raw = await readFile(statsPath, 'utf8');
  const stats = JSON.parse(raw);

  const inputEntries = Object.entries(stats.inputs || {}).map(([inputPath, meta]) => ({
    name: inputPath,
    bytes: Number(meta?.bytes) || 0,
  }));
  const outputEntries = Object.entries(stats.outputs || {}).map(([fileName, meta]) => ({
    name: fileName,
    bytes: Number(meta?.bytes) || 0,
  }));

  const packageTotals = new Map();
  for (const input of inputEntries) {
    const pkg = packageKeyFromInputPath(input.name);
    packageTotals.set(pkg, (packageTotals.get(pkg) || 0) + input.bytes);
  }

  const packageEntries = Array.from(packageTotals.entries()).map(([name, bytes]) => ({
    name,
    bytes,
  }));

  const outputTotals = outputEntries.reduce(
    (acc, entry) => {
      acc.total += entry.bytes;
      if (entry.name.endsWith('.js')) {
        acc.js += entry.bytes;
      } else if (entry.name.endsWith('.css')) {
        acc.css += entry.bytes;
      }
      return acc;
    },
    { total: 0, js: 0, css: 0 }
  );

  const summary = {
    generatedAt: new Date().toISOString(),
    statsPath,
    totals: {
      inputModules: inputEntries.length,
      outputFiles: outputEntries.length,
      outputBytesTotal: outputTotals.total,
      outputBytesJS: outputTotals.js,
      outputBytesCSS: outputTotals.css,
    },
    topInputModules: topEntries(inputEntries, topN),
    topPackagesByInputBytes: topEntries(packageEntries, topN),
    topOutputFiles: topEntries(outputEntries, topN),
  };

  await writeFile(outPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  console.log(`[perf-baseline] Wrote summary to ${path.resolve(outPath)}`);
  console.log(
    `[perf-baseline] Outputs: ${summary.totals.outputFiles} files, ${formatBytes(summary.totals.outputBytesTotal)} total (${formatBytes(summary.totals.outputBytesJS)} JS, ${formatBytes(summary.totals.outputBytesCSS)} CSS)`
  );
  console.log('[perf-baseline] Top packages by input bytes:');
  for (const item of summary.topPackagesByInputBytes.slice(0, 5)) {
    console.log(`  - ${item.name}: ${formatBytes(item.bytes)}`);
  }
}

main().catch((error) => {
  console.error('[perf-baseline] Failed:', error);
  process.exitCode = 1;
});
