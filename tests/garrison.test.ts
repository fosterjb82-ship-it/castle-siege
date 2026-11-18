import { describe, expect, it } from 'vitest';
import { RULES, applyAction, tryAction, util } from '../src/engine';
import type { Action, GameState, Lane } from '../src/engine';
import { afterSetup, toSiege, turn } from './helpers';

function fillGarrison(s: GameState, n: number) {
  for (let i = 0; i < n; i++) util.addTroop(s, 'defender', 'militia', 'N', 'bailey');
}

describe('garrison capacity', () => {
  it('starts at the base capacity, and a Barracks / Garrison Hall raises it', () => {
    const s = afterSetup();
    expect(util.garrisonCapacity(s)).toBe(RULES.garrison.baseCapacity);
    s.baileys.N[0] = { uid: 600, buildingId: 'barracks' };
    expect(util.garrisonCapacity(s)).toBe(RULES.garrison.baseCapacity + 3);
    s.baileys.N[0] = { uid: 600, buildingId: 'garrison_hall' };
    expect(util.garrisonCapacity(s)).toBe(RULES.garrison.baseCapacity + 5);
  });

  it('blocks training when the garrison is full; the Knight does not count', () => {
    let s = turn(afterSetup(), 'lord');
    s.stock.defender.gold = 20;
    fillGarrison(s, util.garrisonRoom(s));
    const r = tryAction(s, { type: 'train', actor: 'lord', troop: 'militia', lane: 'S' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/garrison is full/);
    s.baileys.S[0] = { uid: 601, buildingId: 'barracks' };
    s = applyAction(s, { type: 'train', actor: 'lord', troop: 'militia', lane: 'S' });
    expect(util.defenderTroopCount(s)).toBe(RULES.garrison.baseCapacity + 1);
  });

  it('siege reinforcements only arrive into free capacity', () => {
    let s = toSiege(afterSetup());
    s.baileys.N[0] = { uid: 602, buildingId: 'barracks' };
    fillGarrison(s, util.garrisonRoom(s) - 1); // room for exactly 1
    s.hands.lord = ['archer_company'];
    s = plan(s, { cardId: 'archer_company', lane: 'N' });
    s = advance(s, 3);
    expect(util.garrisonRoom(s)).toBe(0);
    expect(s.log.some((l) => l.text.includes('1 Archers join') && l.text.includes('garrison is full'))).toBe(true);
  });

  it('Militia Levy turns townsfolk into militia beyond the cap, until the town runs out', () => {
    let s = toSiege(afterSetup());
    fillGarrison(s, util.garrisonRoom(s));
    s.population = 3;
    s.hands.lord = ['militia_levy'];
    s = advance(plan(s, { cardId: 'militia_levy', lane: 'N' }), 5);
    expect(s.log.some((l) => l.text.startsWith('Militia Levy: 2 Militia join the North bailey'))).toBe(true);
    expect(s.population).toBe(1);
    // A second levy can only raise the last townsperson.
    s = advance(s, 1); // finish round 1
    s.hands.lord = ['militia_levy'];
    s = advance(plan(s, { cardId: 'militia_levy', lane: 'N' }), 5);
    expect(s.log.some((l) => l.text.startsWith('Militia Levy: 1 Militia join') && l.text.includes('no more able-bodied'))).toBe(true);
    expect(s.population).toBe(0);
  });
});

function plan(s: GameState, lordCard: { cardId: string; lane: Lane }): GameState {
  s = applyAction(s, { type: 'planSiege', actor: 'lord', cards: [lordCard] });
  for (const c of ['architect', 'quartermaster', 'knight'] as const)
    s = applyAction(s, { type: 'planSiege', actor: c, cards: [{ cardId: 'hold_the_line', lane: 'N' }] });
  const adv = { cardId: 'advance', lane: 'S' as Lane, target: 'gate' as const };
  return applyAction(s, { type: 'planSiege', actor: 'warlord', cards: [adv, adv, adv] } as Action);
}

function advance(s: GameState, steps: number): GameState {
  for (let i = 0; i < steps && !s.winner; i++) s = applyAction(s, { type: 'advanceSiege' });
  return s;
}
