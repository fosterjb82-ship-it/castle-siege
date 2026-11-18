import { describe, expect, it } from 'vitest';
import { RULES, applyAction, createGame, util } from '../src/engine';
import { afterSetup, newGame } from './helpers';

describe('setup', () => {
  it('creates a game with starting resources and structures', () => {
    const s = newGame();
    expect(s.stock.defender).toEqual(RULES.startingResources.defender);
    expect(s.stock.warlord).toEqual(RULES.startingResources.warlord);
    expect(s.walls.N.buildingId).toBe('basic_wall');
    expect(s.gates.E.hp).toBe(4);
    expect(s.keep).toEqual({ defense: 3, hp: 8, maxHp: 8 });
    expect(s.siegeDecks.lord).toEqual(['hold_the_line', 'hold_the_line']);
    expect(s.siegeDecks.warlord).toEqual(['advance', 'advance', 'advance']);
    expect(s.phase).toBe('setup');
  });

  it('builds shuffled draft decks from card copies', () => {
    const s = newGame();
    expect(s.draftDecks.defender.tactics.length).toBe(2 * 4 + 3 + 3 + 2 + 2);
    expect(s.draftDecks.warlord.engines.length).toBe(3 + 3 + 2 + 2);
  });

  it('is deterministic for a seed', () => {
    const a = createGame({ seed: 'abc' });
    const b = createGame({ seed: 'abc' });
    expect(a.draftDecks).toEqual(b.draftDecks);
    const c = createGame({ seed: 'abd' });
    expect(c.draftDecks).not.toEqual(a.draftDecks);
  });

  it('keeps placements hidden until both sides have placed', () => {
    let s = newGame();
    s = applyAction(s, { type: 'setupDefenders', militia: ['N', 'N', 'W'] });
    expect(s.troops.length).toBe(0);
    expect(s.phase).toBe('setup');
    s = applyAction(s, { type: 'setupWarlord', camp: 'E', footmen: ['E', 'E', 'N'] });
    expect(s.phase).toBe('build');
    expect(s.troops.filter((t) => t.side === 'defender').map((t) => t.lane).sort()).toEqual(['N', 'N', 'W']);
    expect(util.mainCampLane(s)).toBe('E');
  });

  it('rejects the wrong number of starting troops', () => {
    const s = newGame();
    expect(() => applyAction(s, { type: 'setupDefenders', militia: ['N', 'N'] })).toThrow(/exactly 3/);
  });

  it('starts round 1 with a Collect', () => {
    const s = afterSetup();
    expect(s.round).toBe(1);
    expect(s.step).toBe('chooseCharacter');
    // 4 stone + keep 1
    expect(s.stock.defender.stone).toBe(5);
    // 5 supplies + main camp 2 + base income
    expect(s.stock.warlord.supplies).toBe(5 + 2 + RULES.baseIncome.warlord.supplies);
  });
});
