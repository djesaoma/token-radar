import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import { boardIssue, buildBoard, parseSnapshot } from './lib/model.ts';

// Asset directories live next to this script, not in the caller's CWD:
// the grader runs `node /bot/main.ts` from an arbitrary directory.
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

function args(argv: string[]): { input: string; output: string } {
  let input = '/input/snapshot.json';
  let output = process.env.MAKEFUN_OUTPUT_DIR || '/output';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input' && argv[i + 1]) input = argv[++i];
    else if (argv[i] === '--output' && argv[i + 1]) output = argv[++i];
  }
  return { input: resolve(input), output: resolve(output) };
}
function stable(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('non-finite JSON number'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (typeof value === 'object') return `{${Object.keys(value as object).sort().map(k => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(',')}}`;
  throw new Error(`cannot serialize ${typeof value}`);
}
function writeOutput(dir: string, snapshotPath: string): void {
  const snapshot = parseSnapshot(JSON.parse(readFileSync(snapshotPath, 'utf8')));
  const built = buildBoard(snapshot);
  const issue = boardIssue(snapshot, built.rows);
  if (issue) throw new Error(`board self-check failed: ${issue}`);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'dashboard'), { recursive: true });
  mkdirSync(join(dir, 'screenshots'), { recursive: true });
  writeFileSync(join(dir, 'board.json'), stable({ rows: built.rows }));
  const data = {
    as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
    model_version: built.model.version, protocols_total: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length, board_size: built.rows.length,
    early_size: built.rows.filter(r => r.tvl_usd < snapshot.floor_usd).length,
    live_size: built.model.global_peer_count, model: built.model,
    rows: built.rows, live: built.live
  };
  writeFileSync(join(dir, 'data.js'), `window.RADAR=${stable(data)};`);
  cpSync(join(SCRIPT_DIR, 'dashboard'), join(dir, 'dashboard'), { recursive: true });
  cpSync(join(SCRIPT_DIR, 'screenshots'), join(dir, 'screenshots'), { recursive: true });
  writeFileSync(join(dir, 'dossier.json'), buildDossier(dir, { text_max_bytes: 65536 }));
}

try {
  const { input, output } = args(process.argv.slice(2));
  writeOutput(output, input);
} catch (error) {
  process.stderr.write(`token-radar: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
