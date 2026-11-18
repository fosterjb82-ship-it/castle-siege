import { runAI } from '../engine/ai';
import { card } from '../engine/data';
import { createGame } from '../engine/setup';
import type { Difficulty, GameState, Lane, PlayerSlot } from '../engine/types';

export function aiPlayers(): PlayerSlot[] {
  return [
    { name: 'AI Defenders', controls: ['lord', 'architect', 'quartermaster', 'knight'], ai: true },
    { name: 'AI Warlord', controls: ['warlord'], ai: true },
  ];
}

export function simulateGame(seed: number, difficulty: Difficulty = 'normal'): GameState {
  const s = createGame({ mode: 'coop', difficulty, seed, players: aiPlayers() });
  const end = runAI(s, { autoResolve: true, maxSteps: 20000 });
  if (!end.winner) throw new Error(`Game with seed ${seed} did not finish (step ${end.step}, phase ${end.phase})`);
  return end;
}

export interface SimSummary {
  games: number;
  difficulty: Difficulty;
  defenderWinRate: number;
  warlordWins: number;
  defenderWins: number;
  avgHornsRound: number;
  avgFirstBreachSiegeRound: number | null;
  gamesWithBreach: number;
  avgSiegeRoundsPlayed: number;
  avgKeepHpAtEnd: number;
  breachesByLane: Record<Lane, number>;
  winReasons: Record<string, number>;
  mostDrafted: [string, number][];
  mostPlayed: [string, number][];
  raids: { won: number; lost: number };
}

export function simulate(games: number, difficulty: Difficulty = 'normal', firstSeed = 1): SimSummary {
  let dWins = 0, horns = 0, breachSum = 0, breachGames = 0, siegeRounds = 0, keepHp = 0;
  const lanes: Record<Lane, number> = { N: 0, E: 0, S: 0, W: 0 };
  const reasons: Record<string, number> = {};
  const drafted: Record<string, number> = {};
  const played: Record<string, number> = {};
  const raids = { won: 0, lost: 0 };
  for (let i = 0; i < games; i++) {
    const s = simulateGame(firstSeed + i, difficulty);
    if (s.winner === 'defender') dWins++;
    horns += s.stats.hornsRound ?? 0;
    siegeRounds += s.siegeRound;
    keepHp += s.keep.hp;
    if (s.stats.firstBreach) { breachGames++; breachSum += s.stats.firstBreach.siegeRound; }
    for (const b of s.stats.breaches) lanes[b.lane]++;
    reasons[s.winReason] = (reasons[s.winReason] ?? 0) + 1;
    for (const [k, v] of Object.entries(s.stats.drafted)) drafted[k] = (drafted[k] ?? 0) + v;
    for (const [k, v] of Object.entries(s.stats.cardsPlayed)) played[k] = (played[k] ?? 0) + v;
    raids.won += s.stats.raids.won; raids.lost += s.stats.raids.lost;
  }
  const top = (r: Record<string, number>) =>
    Object.entries(r).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => [card(k).name, v] as [string, number]);
  return {
    games, difficulty,
    defenderWinRate: dWins / games,
    defenderWins: dWins,
    warlordWins: games - dWins,
    avgHornsRound: horns / games,
    avgFirstBreachSiegeRound: breachGames ? breachSum / breachGames : null,
    gamesWithBreach: breachGames,
    avgSiegeRoundsPlayed: siegeRounds / games,
    avgKeepHpAtEnd: keepHp / games,
    breachesByLane: lanes,
    winReasons: reasons,
    mostDrafted: top(drafted),
    mostPlayed: top(played),
    raids,
  };
}

export function formatSummary(r: SimSummary): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  return [
    `Castle Siege — headless simulation (${r.games} games, ${r.difficulty})`,
    `Defender win rate:          ${pct(r.defenderWinRate)}  (${r.defenderWins} D / ${r.warlordWins} W)`,
    `Avg War Horns round:        ${r.avgHornsRound.toFixed(2)}`,
    `Games with a breach:        ${r.gamesWithBreach} (${pct(r.gamesWithBreach / r.games)})`,
    `Avg siege round of breach:  ${r.avgFirstBreachSiegeRound?.toFixed(2) ?? '—'}`,
    `Avg siege rounds played:    ${r.avgSiegeRoundsPlayed.toFixed(2)}`,
    `Avg Keep HP at end:         ${r.avgKeepHpAtEnd.toFixed(2)}`,
    `Breaches by lane:           ${Object.entries(r.breachesByLane).map(([k, v]) => `${k} ${v}`).join(', ')}`,
    `Raids (won/lost):           ${r.raids.won}/${r.raids.lost}`,
    `Win reasons:`,
    ...Object.entries(r.winReasons).map(([k, v]) => `  ${v.toString().padStart(4)}  ${k}`),
    `Most drafted:  ${r.mostDrafted.map(([k, v]) => `${k} (${v})`).join(', ')}`,
    `Most played:   ${r.mostPlayed.map(([k, v]) => `${k} (${v})`).join(', ')}`,
  ].join('\n');
}
