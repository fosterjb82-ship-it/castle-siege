import { describe, expect, it } from 'vitest';
import { RULES, applyAction, runAI, tryAction, util } from '../src/engine';
import type { Action, CardPlanInput, GameState, Lane } from '../src/engine';
import { afterSetup, toSiege } from './helpers';
import { simulateGame } from '../src/sim/simulate';

const HOLD = (lane: Lane): CardPlanInput => ({ cardId: 'hold_the_line', lane });

/** Fill the East approach with Siege Camps (+6 Supply Rating) so tests avoid the over-supply penalty. */
function rating(s: GameState) {
  for (let i = 0; i < 3; i++) s.approaches.E[i] = { uid: 950 + i, buildingId: 'siege_camp' };
}

function siege(mutate?: (s: GameState) => void): GameState {
  const s = toSiege(afterSetup());
  mutate?.(s);
  return s;
}

/** Defenders all play Hold the Line on `defLane`, Warlord plays the given cards. */
function planAll(s: GameState, warlord: CardPlanInput[], defLane: Lane = 'N', extra: Partial<Record<string, Partial<Action>>> = {}): GameState {
  for (const c of ['lord', 'architect', 'quartermaster', 'knight'] as const) {
    s = applyAction(s, { type: 'planSiege', actor: c, cards: [HOLD(defLane)], ...(extra[c] as object) } as Action);
  }
  return applyAction(s, { type: 'planSiege', actor: 'warlord', cards: warlord, ...(extra.warlord as object) } as Action);
}

function resolveTo(s: GameState, step: number): GameState {
  while (s.siege!.stage === 'resolve' && s.siege!.nextStep < step && !s.winner) s = applyAction(s, { type: 'advanceSiege' });
  return s;
}

function resolveRound(s: GameState): GameState {
  const r = s.siegeRound;
  while (!s.winner && s.siegeRound === r) s = applyAction(s, { type: 'advanceSiege' });
  return s;
}

const ADV = (lane: Lane, target: 'gate' | 'wall' = 'gate'): CardPlanInput => ({ cardId: 'advance', lane, target });

describe('siege start and planning', () => {
  it('draws opening hands', () => {
    const s = siege();
    expect(s.phase).toBe('siege');
    expect(s.siegeRound).toBe(1);
    expect(s.hands.lord.length).toBe(2); // only 2 starter cards
    expect(s.hands.warlord.length).toBe(3);
    expect(s.siege!.stage).toBe('plan');
  });

  it('requires one card per character and three for the Warlord', () => {
    const s = siege();
    expect(tryAction(s, { type: 'planSiege', actor: 'lord', cards: [] }).ok).toBe(false);
    expect(tryAction(s, { type: 'planSiege', actor: 'warlord', cards: [ADV('N')] }).ok).toBe(false);
  });

  it('rejects cards not in hand and directional cards in the wrong lane', () => {
    const s = siege((x) => { x.hands.warlord.push('northern_assault'); });
    expect(tryAction(s, { type: 'planSiege', actor: 'lord', cards: [{ cardId: 'shield_wall', lane: 'N' }] }).ok).toBe(false);
    const r = tryAction(s, { type: 'planSiege', actor: 'warlord', cards: [ADV('N'), ADV('N'), { cardId: 'northern_assault', lane: 'S' }] });
    expect(r.ok).toBe(false);
  });

  it('allows the basic fallback only when the siege deck is empty', () => {
    const s = siege((x) => { x.siegeDecks.warlord = ['advance']; });
    expect(tryAction(s, { type: 'planSiege', actor: 'warlord', cards: [ADV('N'), ADV('N'), ADV('N'), ] }).ok).toBe(true);
    const s2 = siege((x) => { x.siegeDecks.warlord = ['advance']; x.hands.warlord = ['advance']; });
    expect(tryAction(s2, { type: 'planSiege', actor: 'warlord', cards: [ADV('N'), { ...ADV('N'), fallback: true }, { ...ADV('N'), fallback: true }] }).ok).toBe(false);
  });

  it('keeps plans hidden until everyone has planned, then reveals', () => {
    let s = siege();
    s = applyAction(s, { type: 'planSiege', actor: 'lord', cards: [HOLD('N')] });
    expect(s.log.at(-1)!.vis).toBe('defender');
    expect(s.siege!.stage).toBe('plan');
    s = planAll({ ...s, siege: { ...s.siege!, planned: [], plays: [] }, hands: { ...s.hands, lord: ['hold_the_line', 'hold_the_line'] } }, [ADV('S'), ADV('S'), ADV('S')]);
    expect(s.siege!.stage).toBe('resolve');
  });
});

describe('resolution steps', () => {
  it('scouting reveals a Warlord card to defenders only', () => {
    let s = siege((x) => { x.hands.lord = ['scout_report']; x.hands.warlord = ['advance', 'advance', 'advance', 'decoy_banners']; });
    s = planAll(s, [ADV('S'), ADV('S'), ADV('S')], 'N', { lord: { cards: [{ cardId: 'scout_report', lane: 'N' }] } });
    s = resolveTo(s, 2);
    expect(s.intel.length).toBe(1);
    expect(s.intel[0].side).toBe('defender');
    // Decoy Banners looks like an attack card.
    expect(s.intel[0].text).toMatch(/Advance/);
  });

  it('towers shoot attacking troops in both adjacent lanes', () => {
    let s = siege((x) => { x.towers.SE = { uid: 900, buildingId: 'arrow_tower', hp: 4, maxHp: 4 }; });
    const before = util.troopsAt(s, 'warlord', 'S', 'approach').length;
    s = planAll(s, [ADV('S'), ADV('S'), ADV('S')]);
    s = resolveTo(s, 3); // through ranged
    expect(util.troopsAt(s, 'warlord', 'S', 'approach').length).toBe(before - 1);
  });

  it('troops in lanes not under attack are not shot', () => {
    let s = siege((x) => { x.towers.NE = { uid: 900, buildingId: 'arrow_tower', hp: 4, maxHp: 4 }; });
    const before = util.troopsAt(s, 'warlord', 'E', 'approach').length;
    s = planAll(s, [ADV('S'), ADV('S'), ADV('S')]);
    s = resolveTo(s, 3);
    expect(util.troopsAt(s, 'warlord', 'E', 'approach').length).toBe(before);
  });

  it('engines attack their structure; a moat stops rams unless bridged', () => {
    let s = siege((x) => { x.hands.warlord = ['battering_ram', 'advance', 'advance']; });
    s = planAll(s, [{ cardId: 'battering_ram', lane: 'E' }, ADV('E'), ADV('E')]);
    s = resolveTo(s, 4);
    // Ram 3 vs wooden gate Defense 1 -> 2 damage.
    expect(s.gates.E.hp).toBe(2);
    expect(s.engines.length).toBe(1);

    let m = siege((x) => { x.moats.E = true; x.hands.warlord = ['battering_ram', 'advance', 'advance']; });
    m = resolveTo(planAll(m, [{ cardId: 'battering_ram', lane: 'E' }, ADV('E'), ADV('E')]), 4);
    expect(m.gates.E.hp).toBe(4);

    let b = siege((x) => { x.moats.E = true; x.hands.warlord = ['battering_ram', 'bridge', 'advance']; });
    b = resolveTo(planAll(b, [{ cardId: 'battering_ram', lane: 'E' }, { cardId: 'bridge', lane: 'E' }, ADV('E')]), 4);
    expect(b.gates.E.hp).toBe(2);
  });

  it('Burning Oil destroys an engine', () => {
    let s = siege((x) => {
      x.engines.push({ uid: 777, cardId: 'battering_ram', lane: 'N', hp: 3, target: 'gate' });
      x.hands.lord = ['burning_oil'];
    });
    s = planAll(s, [ADV('N'), ADV('N'), ADV('N')], 'N', { lord: { cards: [{ cardId: 'burning_oil', lane: 'N' }] } });
    s = resolveTo(s, 3);
    expect(s.engines.length).toBe(0);
  });

  it('melee: damage = attack - (structure Defense + bonuses + defender troops)', () => {
    let s = siege((x) => {
      // 6 footmen in South (2 existing + 4), rating raised so no penalty.
      x.approaches.S[1] = { uid: 901, buildingId: 'siege_camp' };
      x.approaches.S[2] = { uid: 902, buildingId: 'siege_camp' };
      for (let i = 0; i < 4; i++) util.addTroop(x, 'warlord', 'footmen', 'S', 'approach');
    });
    // Attack: 6 footmen + main camp 1 + 3 Advance = 10. Defense: gate 1 + 1 militia = 2 (defenders play in N).
    s = resolveTo(planAll(s, [ADV('S'), ADV('S'), ADV('S')]), 5);
    expect(s.gates.S.hp).toBe(0);
    expect(s.breached.S).toBe(true);
    // Casualty: defenders lower -> lose their weakest troop.
    expect(util.defendersIn(s, 'S').length).toBe(0);
  });

  it('attackers lose their weakest troop when the defense total is higher', () => {
    let s = siege();
    const before = util.troopsAt(s, 'warlord', 'S', 'approach').length;
    s = resolveTo(planAll(s, [ADV('E'), ADV('E'), ADV('S')], 'S'), 5);
    // Attack 2 + 1 + 1 = 4 vs gate 1 + militia 1 + 4 Hold the Line = 6
    expect(util.troopsAt(s, 'warlord', 'S', 'approach').length).toBe(before - 1);
    expect(s.gates.S.hp).toBe(4);
  });

  it('breached lanes let Warlord troops in; an empty bailey means the Keep is attacked', () => {
    let s = siege((x) => {
      x.breached.W = true; x.gates.W.hp = 0;
      rating(x);
      x.approaches.W[0] = { uid: 903, buildingId: 'siege_camp' };
      x.approaches.W[1] = { uid: 904, buildingId: 'siege_camp' };
      for (let i = 0; i < 7; i++) util.addTroop(x, 'warlord', 'footmen', 'W', 'approach');
    });
    const ids = util.troopsAt(s, 'warlord', 'W', 'approach').map((t) => t.uid);
    s = planAll(s, [ADV('W'), ADV('W'), ADV('W')], 'N', { warlord: { moves: [{ from: 'W', to: 'W', troopUids: ids }] } });
    s = resolveTo(s, 5);
    expect(util.troopsAt(s, 'warlord', 'W', 'bailey').length).toBe(7);
    // 7 + 3 = 10 attack vs Keep Defense 3 -> 7 damage.
    expect(s.keep.hp).toBe(1);
  });

  it('the Warlord wins when the Keep falls', () => {
    let s = siege((x) => {
      x.keep.hp = 2;
      x.breached.W = true; x.gates.W.hp = 0;
      rating(x);
      x.approaches.W[0] = { uid: 903, buildingId: 'siege_camp' };
      for (let i = 0; i < 5; i++) util.addTroop(x, 'warlord', 'footmen', 'W', 'bailey');
    });
    s = resolveTo(planAll(s, [ADV('W'), ADV('W'), ADV('W')]), 5);
    expect(s.winner).toBe('warlord');
    expect(s.phase).toBe('ended');
  });

  it('fighting inside a bailey: the loser loses troops by margin and buildings burn', () => {
    let s = siege((x) => {
      x.breached.N = true; x.walls.N.hp = 0;
      x.baileys.N[0] = { uid: 905, buildingId: 'quarry' };
      rating(x);
      x.approaches.N[0] = { uid: 906, buildingId: 'siege_camp' };
      x.approaches.N[1] = { uid: 907, buildingId: 'siege_camp' };
      for (let i = 0; i < 6; i++) util.addTroop(x, 'warlord', 'footmen', 'N', 'bailey');
      x.knight.lane = 'E';
    });
    // 6 + 3 attack vs 1 militia + 4 Hold the Line... play defenders in S so only militia defends: 9 vs 1
    s = resolveTo(planAll(s, [ADV('N'), ADV('N'), ADV('N')], 'S'), 5);
    expect(util.defendersIn(s, 'N').length).toBe(0);
    expect(s.baileys.N[0]).toBeNull();
    // Spillover: margin 8 - Keep Defense 3 = 5
    if (RULES.bailey.keepSpillover) expect(s.keep.hp).toBe(3);
  });

  it('recovery: repairs, Architect repair and Lord rally', () => {
    let s = siege((x) => { x.gates.N.hp = 1; x.walls.E.hp = 2; x.hands.lord = ['emergency_repairs']; });
    s = planAll(s, [ADV('S'), ADV('S'), ADV('S')], 'N', {
      lord: { cards: [{ cardId: 'emergency_repairs', lane: 'N', target: 'gate' }], ability: { lordRally: 'S' } },
      architect: { ability: { architectRepair: { lane: 'E', structure: 'wall' } } },
    });
    s = resolveRound(s);
    expect(s.gates.N.hp).toBe(4);
    expect(s.walls.E.hp).toBe(4);
    expect(s.siege!.rallyActive.S).toBe(RULES.lordRally.defense);
  });

  it('defenders win after the final siege round', () => {
    let s = siege();
    for (let r = 0; r < RULES.siegeRounds && !s.winner; r++) {
      const fresh = (a: 'lord' | 'architect' | 'quartermaster' | 'knight') => s.hands[a][0] ?? 'hold_the_line';
      for (const c of ['lord', 'architect', 'quartermaster', 'knight'] as const)
        s = applyAction(s, { type: 'planSiege', actor: c, cards: [{ cardId: fresh(c), lane: 'N', fallback: !s.hands[c].length }] });
      s = applyAction(s, { type: 'planSiege', actor: 'warlord', cards: [ADV('N'), ADV('N'), ADV('N')].map((c, i) => ({ ...c, fallback: i >= s.hands.warlord.length })) });
      s = resolveRound(s);
    }
    expect(s.winner).toBe('defender');
  });

  it('defenders win at once if the Warlord has no troops and no troop cards', () => {
    let s = siege((x) => { x.troops = x.troops.filter((t) => t.side !== 'warlord'); });
    s = resolveTo(planAll(s, [ADV('N'), ADV('N'), ADV('N')]), 1);
    expect(s.winner).toBe('defender');
  });
});

describe('AI and determinism', () => {
  it('plays a full AI vs AI game to completion', () => {
    const s = simulateGame(7);
    expect(s.winner).not.toBeNull();
    expect(s.siegeRound).toBeGreaterThanOrEqual(1);
  });

  it('replays identically from the same seed', () => {
    const a = simulateGame(11);
    const b = simulateGame(11);
    expect(a.log).toEqual(b.log);
    expect(a.winner).toBe(b.winner);
  });

  it('runAI stops when a human must act', () => {
    const s = runAI(afterSetup(), { autoResolve: true });
    expect(s.step).toBe('chooseCharacter'); // co-op default: human defenders, AI warlord... here warlord mode -> nobody is AI
  });
});
