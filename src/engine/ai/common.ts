import type { GameState, Lane } from '../types';
import { LANES } from '../types';
import { building, card } from '../data';
import { apparentWarlordCount, baileyStrength, cornersCovering, laneBuildingAttack, mainCampLane, sumStrength, towerDefense, troopsAt } from '../util';

/** Deterministic local RNG for AI choices, derived from the state without mutating it. */
export function aiRng(s: GameState, salt = 0) {
  let t = (s.rng ^ Math.imul(s.log.length + 1, 2654435761) ^ Math.imul(salt + 7, 40503)) | 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** How hard a lane is to crack, from the attacker's point of view. */
export function laneToughness(s: GameState, lane: Lane): number {
  if (s.breached[lane]) return -100;
  const gateDef = building(s.gates[lane].buildingId).structure!.defense;
  const wallDef = building(s.walls[lane].buildingId).structure!.defense;
  const gateHp = s.gates[lane].hp;
  const wallHp = s.walls[lane].hp;
  const weakest = Math.min(gateDef + gateHp / 2, wallDef + wallHp / 2);
  return weakest + baileyStrength(s, lane) + towerDefense(s, lane) + (s.moats[lane] ? 1.5 : 0);
}

export function warlordTargetLane(s: GameState): Lane {
  const breached = LANES.filter((l) => s.breached[l]);
  if (breached.length) {
    return breached.sort((a, b) => baileyStrength(s, a) - baileyStrength(s, b))[0];
  }
  const main = mainCampLane(s);
  // Commitment: engines already on the board and camps in a lane make the Warlord stick with it.
  const commitment = (l: Lane) =>
    sumStrength(s, troopsAt(s, 'warlord', l, 'approach')) * (s.phase === 'siege' ? 1.5 : 0.6)
    + s.engines.filter((e) => e.lane === l).length * 4
    + s.approaches[l].filter(Boolean).length * 1.5
    + (l === main ? 2 : 0);
  let lanes = [...LANES];
  if (s.phase === 'siege') {
    // In the siege, only lanes where the army actually stands are real options.
    const manned = lanes.filter((l) => troopsAt(s, 'warlord', l, 'approach').length || s.engines.some((e) => e.lane === l));
    if (manned.length) lanes = manned;
  }
  return lanes.sort((a, b) => (laneToughness(s, a) - commitment(a)) - (laneToughness(s, b) - commitment(b)))[0];
}

/** Visible threat to a lane, from the defenders' point of view. */
export function laneThreat(s: GameState, lane: Lane): number {
  // Defenders judge by what they can see: during the Siege phase, stratagems can fool them.
  const real = troopsAt(s, 'warlord', lane, 'approach');
  const avg = real.length ? sumStrength(s, real) / real.length : 1.3;
  const inApproach = s.phase === 'blockade' ? apparentWarlordCount(s, lane) * avg : sumStrength(s, real);
  const inBailey = sumStrength(s, troopsAt(s, 'warlord', lane, 'bailey'));
  const engines = s.engines.filter((e) => e.lane === lane)
    .reduce((a, e) => a + (card(e.cardId).effects.find((x) => x.type === 'engine')?.attack ?? 0), 0);
  const camp = laneBuildingAttack(s, lane) + s.approaches[lane].filter(Boolean).length * 0.5;
  const damage = (s.walls[lane].maxHp - s.walls[lane].hp) * 0.3 + (s.gates[lane].maxHp - s.gates[lane].hp) * 0.4;
  return inApproach + inBailey * 3 + engines + camp + damage + (s.breached[lane] ? 6 : 0);
}

export function lanesByThreat(s: GameState): Lane[] {
  return [...LANES].sort((a, b) => laneThreat(s, b) - laneThreat(s, a));
}

export function coveringTowerCount(s: GameState, lane: Lane) {
  return cornersCovering(lane).filter((c) => s.towers[c]).length;
}
