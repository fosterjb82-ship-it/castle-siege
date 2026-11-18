import { describe, expect, it } from 'vitest';
import { applyAction, tryAction, util } from '../src/engine';
import { act, afterSetup, passAll, turn } from './helpers';

describe('build phase turn structure', () => {
  it('gives each character 2 actions, then the Warlord 1', () => {
    let s = turn(afterSetup(), 'lord');
    expect(s.turn.actionsLeft).toBe(2);
    s = act(s, { type: 'trade', actor: 'lord', give: 'stone', get: 'gold' });
    expect(s.turn.actionsLeft).toBe(1);
    s = act(s, { type: 'trade', actor: 'lord', give: 'wood', get: 'gold' });
    expect(s.step).toBe('warlordTurn');
    s = act(s, { type: 'endTurn', actor: 'warlord' });
    expect(s.step).toBe('chooseCharacter');
    expect(s.turn.done).toEqual(['lord']);
  });

  it('does not let a character act twice in a round', () => {
    let s = act(turn(afterSetup(), 'lord'), { type: 'endTurn', actor: 'lord' }, { type: 'endTurn', actor: 'warlord' });
    expect(tryAction(s, { type: 'chooseCharacter', character: 'lord' }).ok).toBe(false);
  });

  it('runs rounds and offers the War Horns from round 4', () => {
    let s = afterSetup();
    for (let r = 1; r <= 3; r++) s = passAll(s);
    expect(s.round).toBe(4);
    s = passAll(s);
    expect(s.step).toBe('hornsDecision');
    s = applyAction(s, { type: 'holdHorns' });
    expect(s.round).toBe(5);
  });

  it('sounds the horns automatically after round 8, starting the Siege (blockade) phase and the relief clock', () => {
    let s = afterSetup();
    while (s.round < 8 || s.step !== 'chooseCharacter') {
      s = passAll(s);
      if (s.step === 'hornsDecision') s = applyAction(s, { type: 'holdHorns' });
    }
    s = passAll(s);
    expect(s.hornsSounded).toBe(true);
    expect(s.phase).toBe('blockade');
    expect(s.relief!.roundsLeft).toBe(7);
  });
});

describe('building', () => {
  it('builds in an empty bailey slot and pays from the shared stockpile', () => {
    let s = turn(afterSetup(), 'lord');
    const wood = s.stock.defender.wood;
    s = act(s, { type: 'build', actor: 'lord', slot: { kind: 'bailey', lane: 'N', index: 0 }, buildingId: 'quarry' });
    expect(s.baileys.N[0]?.buildingId).toBe('quarry');
    expect(s.stock.defender.wood).toBe(wood - 2);
  });

  it('rejects occupied slots and wrong slot types', () => {
    let s = turn(afterSetup(), 'lord');
    s = act(s, { type: 'build', actor: 'lord', slot: { kind: 'bailey', lane: 'N', index: 0 }, buildingId: 'quarry' });
    expect(tryAction(s, { type: 'build', actor: 'lord', slot: { kind: 'bailey', lane: 'N', index: 0 }, buildingId: 'quarry' }).ok).toBe(false);
    expect(tryAction(s, { type: 'build', actor: 'lord', slot: { kind: 'tower', corner: 'NE' }, buildingId: 'quarry' }).ok).toBe(false);
  });

  it('applies the Architect discount on walls, gates and towers', () => {
    let s = turn(afterSetup(), 'architect');
    const stone = s.stock.defender.stone;
    s = act(s, { type: 'build', actor: 'architect', slot: { kind: 'tower', corner: 'NE' }, buildingId: 'arrow_tower' });
    expect(s.stock.defender.stone).toBe(stone - 1); // 2 Stone - 1
    expect(s.towers.NE?.buildingId).toBe('arrow_tower');
  });

  it('upgrades a wall and keeps damage', () => {
    let s = afterSetup();
    s.walls.N.hp = 4; // 2 damage
    s = act(turn(s, 'lord'), { type: 'build', actor: 'lord', slot: { kind: 'wall', lane: 'N' }, buildingId: 'stone_wall' });
    expect(s.walls.N).toMatchObject({ buildingId: 'stone_wall', maxHp: 10, hp: 8 });
  });

  it('requires the previous building for upgrades', () => {
    const s = turn(afterSetup(), 'lord');
    expect(tryAction(s, { type: 'build', actor: 'lord', slot: { kind: 'gate', lane: 'N' }, buildingId: 'gatehouse' }).ok).toBe(false);
  });

  it('forces the first Siege Workshop into the Main Siege Camp approach', () => {
    let s = act(turn(afterSetup(), 'lord'), { type: 'endTurn', actor: 'lord' });
    s.stock.warlord.timber = 10;
    expect(tryAction(s, { type: 'build', actor: 'warlord', slot: { kind: 'approach', lane: 'N', index: 0 }, buildingId: 'siege_workshop' }).ok).toBe(false);
    s = act(s, { type: 'build', actor: 'warlord', slot: { kind: 'approach', lane: 'S', index: 1 }, buildingId: 'siege_workshop' });
    expect(util.hasBuilding(s, 'warlord', 'siege_workshop')).toBe(true);
  });

  it('collects production next round and skips harassed buildings', () => {
    let s = turn(afterSetup(), 'lord');
    s = act(s, { type: 'build', actor: 'lord', slot: { kind: 'bailey', lane: 'N', index: 0 }, buildingId: 'quarry' });
    const before = s.stock.defender.stone;
    s = passAll(act(s, { type: 'endTurn', actor: 'lord' }));
    expect(s.stock.defender.stone).toBe(before + 1 + 2);
  });
});

describe('troops, moves and economy', () => {
  it('trains troops with requirements and the Knight discount', () => {
    let s = turn(afterSetup(), 'knight');
    expect(tryAction(s, { type: 'train', actor: 'knight', troop: 'archers', lane: 'N' }).ok).toBe(false);
    const gold = s.stock.defender.gold;
    s = act(s, { type: 'train', actor: 'knight', troop: 'militia', lane: 'W' });
    // Discount never makes a troop free.
    expect(s.stock.defender.gold).toBe(gold - 1);
    expect(util.defendersIn(s, 'W').length).toBe(1);
  });

  it('moves troops only between adjacent baileys', () => {
    const s = turn(afterSetup(), 'lord');
    expect(tryAction(s, { type: 'move', actor: 'lord', from: 'N', to: 'S' }).ok).toBe(false);
    const s2 = applyAction(s, { type: 'move', actor: 'lord', from: 'N', to: 'E' });
    expect(util.defendersIn(s2, 'E').length).toBe(2);
  });

  it('trades 2:1', () => {
    let s = turn(afterSetup(), 'lord');
    const { stone, gold } = s.stock.defender;
    s = act(s, { type: 'trade', actor: 'lord', give: 'stone', get: 'gold' });
    expect(s.stock.defender.stone).toBe(stone - 2);
    expect(s.stock.defender.gold).toBe(gold + 1);
  });

  it('allows Decree once per round', () => {
    let s = turn(afterSetup(), 'lord');
    s = act(s, { type: 'decree', actor: 'lord', resource: 'gold' });
    expect(tryAction(s, { type: 'decree', actor: 'lord', resource: 'gold' }).ok).toBe(false);
  });

  it('Requisition trades 1:1 up to 3', () => {
    let s = turn(afterSetup(), 'quartermaster');
    const st = { ...s.stock.defender };
    s = act(s, { type: 'requisition', actor: 'quartermaster', give: 'stone', get: 'gold', amount: 3 });
    expect(s.stock.defender.stone).toBe(st.stone - 3);
    expect(s.stock.defender.gold).toBe(st.gold + 3);
  });

  it('Warlord recruits only at camps and marches to adjacent approaches', () => {
    let s = act(turn(afterSetup(), 'lord'), { type: 'endTurn', actor: 'lord' });
    expect(tryAction(s, { type: 'recruit', troop: 'footmen', lane: 'N' }).ok).toBe(false);
    s = act(s, { type: 'recruit', troop: 'footmen', lane: 'S', count: 2 });
    expect(util.troopsAt(s, 'warlord', 'S', 'approach').length).toBe(4);
    s = act(turn(s, 'architect'), { type: 'endTurn', actor: 'architect' });
    const ids = util.troopsAt(s, 'warlord', 'S', 'approach').slice(0, 3).map((t) => t.uid);
    s = act(s, { type: 'march', from: 'S', to: 'W', troopUids: ids });
    expect(util.troopsAt(s, 'warlord', 'W', 'approach').length).toBe(3);
  });

  it('applies the over-supply penalty', () => {
    const s = afterSetup();
    const t = s.troops.find((x) => x.side === 'warlord')!;
    expect(util.troopStrength(s, t)).toBe(1);
    for (let i = 0; i < 5; i++) util.addTroop(s, 'warlord', 'footmen', 'S', 'approach');
    expect(util.overSupplied(s)).toBe(true);
    expect(util.troopStrength(s, t)).toBe(0);
  });
});

describe('draft', () => {
  it('draws 3, keeps 1 into the character deck, returns 2 to the bottom', () => {
    let s = turn(afterSetup(), 'lord');
    const deckLen = s.draftDecks.defender.tactics.length;
    s = act(s, { type: 'draft', actor: 'lord', deck: 'tactics' });
    expect(s.step).toBe('draftPick');
    const drawn = s.pendingDraft!.cards;
    expect(drawn.length).toBe(3);
    s = act(s, { type: 'draftPick', actor: 'lord', index: 1 });
    expect(s.siegeDecks.lord).toContain(drawn[1]);
    expect(s.draftDecks.defender.tactics.length).toBe(deckLen - 1);
    expect(s.draftDecks.defender.tactics.slice(-2)).toEqual([drawn[0], drawn[2]]);
    expect(s.turn.actionsLeft).toBe(1);
  });

  it('requires the unlocking building', () => {
    const s = turn(afterSetup(), 'lord');
    expect(tryAction(s, { type: 'draft', actor: 'lord', deck: 'garrison' }).ok).toBe(false);
  });
});

describe('raids and harass', () => {
  it('a winning raid burns a building and kills a troop', () => {
    let s = afterSetup();
    s.approaches.E[0] = { uid: 999, buildingId: 'foraging_camp' };
    s = turn(s, 'knight');
    const militia = util.defendersIn(s, 'E').map((t) => t.uid);
    // Knight 2 + militia 1 = 3 vs footman 1 + 2 camp guards = 3 -> tie loses; add a militia.
    util.addTroop(s, 'defender', 'militia', 'E', 'bailey');
    const party = util.defendersIn(s, 'E').map((t) => t.uid).slice(0, 2);
    void militia;
    s = act(s, { type: 'raid', actor: 'knight', lane: 'E', troopUids: party });
    expect(s.approaches.E[0]).toBeNull();
    expect(util.troopsAt(s, 'warlord', 'E', 'approach').length).toBe(0);
  });

  it('a failed raid loses a troop and damages the gate', () => {
    let s = turn(afterSetup(), 'knight');
    s.approaches.S[1] = { uid: 998, buildingId: 'siege_camp' }; // +2 Supply Rating, so no over-supply penalty
    for (let i = 0; i < 2; i++) util.addTroop(s, 'warlord', 'footmen', 'S', 'approach');
    const party = util.defendersIn(s, 'S').map((t) => t.uid);
    s = act(s, { type: 'raid', actor: 'knight', lane: 'S', troopUids: party });
    expect(util.defendersIn(s, 'S').length).toBe(0);
    expect(s.gates.S.hp).toBe(2);
  });

  it('harass stops one production building for the next Collect', () => {
    let s = afterSetup();
    s.baileys.S[0] = { uid: 500, buildingId: 'quarry' };
    s = act(turn(s, 'lord'), { type: 'endTurn', actor: 'lord' });
    util.addTroop(s, 'warlord', 'footmen', 'S', 'approach');
    s = act(s, { type: 'harass', lane: 'S' });
    expect(s.harassed).toContain(500);
    const stone = s.stock.defender.stone;
    s = passAll(s);
    expect(s.stock.defender.stone).toBe(stone + 1); // keep only
    expect(s.harassed).toEqual([]);
  });
});
