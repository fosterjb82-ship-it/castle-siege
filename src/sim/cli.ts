// Headless AI-vs-AI simulation. Usage:
//   npm run sim -- --games 200 --difficulty normal|easy|hard|all --seed 1
//                  [--override variant.json] [--json out.json] [--log <seed>]
import { readFileSync, writeFileSync } from 'node:fs';
import { applyOverrides } from './overrides';
import type { Difficulty } from '../engine/types';
import { formatSummary, simulate, simulateGame } from './simulate';

const args = process.argv.slice(2);
const arg = (name: string, def?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};

const overrideFile = arg('override');
if (overrideFile) {
  applyOverrides(JSON.parse(readFileSync(overrideFile, 'utf8')));
  console.log(`Applied overrides from ${overrideFile}\n`);
}

const logSeed = arg('log');
if (logSeed) {
  const s = simulateGame(Number(logSeed), (arg('difficulty', 'normal') as Difficulty));
  console.log(s.log.map((l) => (l.vis === 'all' ? '' : `[${l.vis}] `) + l.text).join('\n'));
  process.exit(0);
}

const games = Number(arg('games', '100'));
const difficulties = (arg('difficulty', 'normal') === 'all' ? ['easy', 'normal', 'hard'] : [arg('difficulty', 'normal')]) as Difficulty[];
const seed = Number(arg('seed', '1'));
const results = difficulties.map((d) => {
  const t0 = Date.now();
  const r = simulate(games, d, seed);
  console.log(formatSummary(r));
  console.log(`(${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
  return r;
});
const out = arg('json');
if (out) writeFileSync(out, JSON.stringify(results, null, 2));
