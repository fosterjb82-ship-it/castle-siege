import { describe, expect, it } from 'vitest';
import { RULES, applyAction, tryAction, util } from '../src/engine';
import type { GameState } from '../src/engine';
import { act, afterSetup, passAll, toBlockade, turn } from './helpers';

/** Finish the current Siege round with everyone passing; stops at the Assault decision. */
function passBlockadeRound(s: GameState): GameState {
  return passAll(s);
}

describe('War Horns and the relief clock', () => {
  it('the horns start the Siege (blockade) phase with the relief army 7 rounds away', () => {
    const s = toBlockade(afterSetup());
    expect(s.phase).toBe('blockade');
    expect(s.relief!.roundsLeft).toBe(RULES.relief.rounds);
    expect(s.blockade!.round).toBe(1);
    expect(s.step).toBe('chooseCharacter');
  });

  it('each character has 1 action per Siege round, and the Warlord still responds', () => {
    let s = turn(toBlockade(afterSetup()), 'lord');
    expect(s.turn.actionsLeft).toBe(1);
    s = act(s, { type: 'trade', actor: 'lord', give: 'stone', get: 'gold' });
    expect(s.step).toBe('warlordTurn');
  });

  it('after each Siege round the Warlord decides; holding ticks the clock, and it forces the Assault at 3', () => {
    let s = passBlockadeRound(toBlockade(afterSetup()));
    expect(s.step).toBe('assaultDecision');
    expect(s.relief!.roundsLeft).toBe(6);
    s = applyAction(s, { type: 'holdSiege' });
    expect(s.blockade!.round).toBe(2);
    s = passBlockadeRound(s); // 5 left
    s = applyAction(s, { type: 'holdSiege' });
    s = passBlockadeRound(s); // 4 left
    s = applyAction(s, { type: 'holdSiege' });
    s = passBlockadeRound(s); // 3 left -> forced
    expect(s.phase).toBe('siege');
    expect(s.stats.assaultForced).toBe(true);
    expect(s.stats.blockadeRounds).toBe(4);
    expect(s.relief!.roundsLeft).toBe(RULES.relief.forceAssaultAt);
  });

  it('ordering the Assault draws hands and starts Assault round 1', () => {
    let s = passBlockadeRound(toBlockade(afterSetup()));
    s = applyAction(s, { type: 'orderAssault' });
    expect(s.phase).toBe('siege');
    expect(s.siegeRound).toBe(1);
    expect(s.hands.warlord.length).toBeGreaterThan(0);
  });
});

describe('food under blockade', () => {
  it('no Food comes in and the garrison eats each Siege round', () => {
    let s = afterSetup();
    s.stock.defender.food = 6;
    s = toBlockade(s); // round 1: collect (no food), eat 1
    expect(s.stock.defender.food).toBe(5);
    s = applyAction(passBlockadeRound(s), { type: 'holdSiege' });
    expect(s.stock.defender.food).toBe(4);
  });

  it('no action can produce Food during the siege', () => {
    let s = turn(toBlockade(afterSetup()), 'lord');
    expect(tryAction(s, { type: 'decree', actor: 'lord', resource: 'food' }).ok).toBe(false);
    expect(tryAction(s, { type: 'trade', actor: 'lord', give: 'stone', get: 'food' }).ok).toBe(false);
    expect(tryAction(s, { type: 'decree', actor: 'lord', resource: 'gold' }).ok).toBe(true);
  });
});

describe('defender Siege actions', () => {
  it('Repair restores a damaged wall for 1 Stone (Architect +1)', () => {
    let s = toBlockade(afterSetup());
    s.walls.N.hp = 2;
    s = turn(s, 'architect');
    const stone = s.stock.defender.stone;
    s = applyAction(s, { type: 'repair', actor: 'architect', lane: 'N', structure: 'wall' });
    expect(s.walls.N.hp).toBe(5);
    expect(s.stock.defender.stone).toBe(stone - 1);
    expect(tryAction(turn(applyAction(s, { type: 'endTurn', actor: 'warlord' }), 'lord'), { type: 'repair', actor: 'lord', lane: 'E', structure: 'wall' }).ok).toBe(false); // undamaged
  });

  it('Levy turns townsfolk into Militia beyond the cap', () => {
    let s = toBlockade(afterSetup());
    for (let i = 0; i < util.garrisonRoom(s); i++) util.addTroop(s, 'defender', 'militia', 'N', 'bailey');
    const before = util.defenderTroopCount(s);
    s = applyAction(turn(s, 'lord'), { type: 'levy', actor: 'lord', lane: 'S' });
    expect(util.defenderTroopCount(s)).toBe(before + 2);
    expect(s.population).toBe(RULES.garrison.startingPopulation - 2);
  });

  it('a Sortie can burn an emplaced engine', () => {
    let s = toBlockade(afterSetup());
    s.engines.push({ uid: 990, cardId: 'catapult', lane: 'N', hp: 3, target: 'tower' });
    s = turn(s, 'knight');
    const party = util.defendersIn(s, 'N').map((t) => t.uid);
    s = applyAction(s, { type: 'raid', actor: 'knight', lane: 'N', troopUids: party, targetEngineUid: 990 });
    expect(s.engines.length).toBe(0);
  });
});

describe('Warlord Siege actions and deception', () => {
  it('Emplace puts an engine from the siege deck on the board; Catapults bombard each Siege round', () => {
    let s = afterSetup();
    s.siegeDecks.warlord.push('catapult');
    s.towers.NE = { uid: 991, buildingId: 'arrow_tower', hp: 4, maxHp: 4 };
    s = toBlockade(s);
    s = act(turn(s, 'lord'), { type: 'endTurn', actor: 'lord' });
    s = applyAction(s, { type: 'emplace', cardId: 'catapult', lane: 'N', target: 'tower' });
    expect(s.engines.map((e) => e.cardId)).toEqual(['catapult']);
    expect(s.siegeDecks.warlord).not.toContain('catapult');
    s = applyAction(passBlockadeRound(s), { type: 'holdSiege' }); // round 2 begins: bombardment
    expect(s.towers.NE!.hp).toBe(2);
  });

  it('Night March moves troops secretly: the defenders still see them where they were', () => {
    let s = afterSetup(); // footmen S, S, E
    s.siegeDecks.warlord.push('night_march');
    s = act(turn(toBlockade(s), 'lord'), { type: 'endTurn', actor: 'lord' });
    s = applyAction(s, { type: 'stratagem', cardId: 'night_march', lane: 'S', to: 'W', count: 2 });
    expect(util.troopsAt(s, 'warlord', 'W', 'approach').length).toBe(2);
    expect(util.apparentWarlordCount(s, 'S')).toBe(2);
    expect(util.apparentWarlordCount(s, 'W')).toBe(0);
    // The defenders' log hides the details.
    expect(s.log.filter((l) => l.text.includes('Night March')).every((l) => l.vis === 'warlord')).toBe(true);
  });

  it('Campfires add phantom troops; scouting reveals the truth', () => {
    let s = afterSetup();
    s.siegeDecks.warlord.push('campfires');
    s = act(turn(toBlockade(s), 'lord'), { type: 'endTurn', actor: 'lord' });
    s = applyAction(s, { type: 'stratagem', cardId: 'campfires', lane: 'N' });
    expect(util.apparentWarlordCount(s, 'N')).toBe(RULES.stratagems.campfiresPhantom);
    s = applyAction(turn(s, 'architect'), { type: 'scout', actor: 'architect', lane: 'N' });
    expect(util.apparentWarlordCount(s, 'N')).toBe(0);
    expect(s.log.some((l) => l.vis === 'defender' && l.text.includes('not the 4 we thought'))).toBe(true);
  });

  it('the Assault reveals every hidden position', () => {
    let s = afterSetup();
    s.siegeDecks.warlord.push('campfires');
    s = act(turn(toBlockade(s), 'lord'), { type: 'endTurn', actor: 'lord' });
    s = applyAction(s, { type: 'stratagem', cardId: 'campfires', lane: 'W' });
    s = applyAction(passBlockadeRound(s), { type: 'orderAssault' });
    expect(util.apparentWarlordCount(s, 'W')).toBe(0);
    expect(s.log.some((l) => l.text.includes('deceived in the West approach'))).toBe(true);
  });
});
