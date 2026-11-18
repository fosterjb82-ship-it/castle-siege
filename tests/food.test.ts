import { describe, expect, it } from 'vitest';
import { RULES, applyAction, util } from '../src/engine';
import type { Action, GameState, Lane } from '../src/engine';
import { afterSetup, passAll, toSiege, turn } from './helpers';

function planHold(s: GameState): GameState {
  for (const c of ['lord', 'architect', 'quartermaster', 'knight'] as const)
    s = applyAction(s, { type: 'planSiege', actor: c, cards: [{ cardId: 'hold_the_line', lane: 'N' }] });
  const adv = { cardId: 'advance', lane: 'S' as Lane, target: 'gate' as const };
  return applyAction(s, { type: 'planSiege', actor: 'warlord', cards: [adv, adv, adv] } as Action);
}

function finishRound(s: GameState): GameState {
  const r = s.siegeRound;
  while (!s.winner && s.siegeRound === r) s = applyAction(s, { type: 'advanceSiege' });
  return s;
}

describe('food', () => {
  it('the Keep and Granaries produce Food during the Build Phase', () => {
    let s = turn(afterSetup(), 'lord');
    const food = s.stock.defender.food;
    s = applyAction(s, { type: 'build', actor: 'lord', slot: { kind: 'bailey', lane: 'N', index: 0 }, buildingId: 'granary' });
    s = passAll(applyAction(s, { type: 'endTurn', actor: 'lord' }));
    expect(s.stock.defender.food).toBe(food + 1 + 2);
  });

  it('upkeep is 1 Food per 3 troops, eaten at the start of each siege round, with no Food income', () => {
    const s = afterSetup();
    expect(util.foodUpkeep(s)).toBe(1); // 3 militia
    util.addTroop(s, 'defender', 'militia', 'N', 'bailey');
    expect(util.foodUpkeep(s)).toBe(2);
    let g = toSiege(afterSetup());
    g.stock.defender.food = 5;
    g = finishRound(planHold(g));
    // Round 2 begins: no income, 1 eaten.
    expect(g.stock.defender.food).toBe(4);
    expect(g.hungry).toBe(false);
  });

  it('running out of Food makes the garrison hungry: −1 Strength to every defender troop', () => {
    let s = toSiege(afterSetup());
    s.stock.defender.food = 0;
    s = finishRound(planHold(s));
    expect(s.hungry).toBe(true);
    const m = s.troops.find((t) => t.side === 'defender')!;
    expect(util.troopStrength(s, m)).toBe(Math.max(0, 1 - RULES.food.hungerStrengthPenalty));
    expect(s.log.some((l) => l.text.includes('HUNGER'))).toBe(true);
  });

  it('Harass can starve a Granary', () => {
    let s = afterSetup();
    s.baileys.S[0] = { uid: 700, buildingId: 'granary' };
    s = applyAction(turn(s, 'lord'), { type: 'endTurn', actor: 'lord' });
    util.addTroop(s, 'warlord', 'footmen', 'S', 'approach');
    s = applyAction(s, { type: 'harass', lane: 'S', buildingUid: 700 });
    const food = s.stock.defender.food;
    s = passAll(s);
    expect(s.stock.defender.food).toBe(food + 1); // only the Keep
  });
});
