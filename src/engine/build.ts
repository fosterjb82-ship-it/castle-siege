import { CHARACTER_DEFS, MAP, RULES, building, card, laneName, troopDef } from './data';
import { startSiege } from './siege';
import type { Action, Actor, CharacterId, GameState, Lane, Resources, Side, SlotRef } from './types';
import { CHARACTERS, DEFENDER_RES, LANES, WARLORD_RES } from './types';
import {
  addRes, addTroop, adjacent, canAfford, cap, defendersIn, discount, fail, fmtRes, hasBuilding,
  incomeFor, log, mainCampLane, overSupplied, pay, removeTroop, sideOf, sumStrength, supplyRating,
  troopsAt, uid, warlordTroopCount, weakest, countBuilding, garrisonRoom, garrisonCapacity, defenderTroopCount,
} from './util';

const ACTOR_NAME = (a: Actor) => (a === 'warlord' ? 'Warlord' : CHARACTER_DEFS[a].name);

// ---------------- Setup ----------------

export function setupDefenders(s: GameState, a: Extract<Action, { type: 'setupDefenders' }>) {
  if (s.phase !== 'setup') fail('Not in setup');
  if (s.setupDone.defender) fail('Defenders already placed');
  const n = RULES.startingTroops.defender.militia;
  if (a.militia.length !== n || !a.militia.every((l) => LANES.includes(l))) fail(`Place exactly ${n} Militia in baileys`);
  s.setupHidden.defender = [...a.militia, a.knight ?? a.militia[0]];
  s.setupDone.defender = true;
  log(s, 'Defenders have placed their troops (hidden).');
  maybeFinishSetup(s);
}

export function setupWarlord(s: GameState, a: Extract<Action, { type: 'setupWarlord' }>) {
  if (s.phase !== 'setup') fail('Not in setup');
  if (s.setupDone.warlord) fail('Warlord already placed');
  const n = RULES.startingTroops.warlord.footmen;
  if (!LANES.includes(a.camp)) fail('Choose an approach for the Main Siege Camp');
  if (a.footmen.length !== n || !a.footmen.every((l) => LANES.includes(l))) fail(`Place exactly ${n} Footmen in approaches`);
  s.setupHidden.warlord = { camp: a.camp, footmen: [...a.footmen] };
  s.setupDone.warlord = true;
  log(s, 'The Warlord has placed the camp and troops (hidden).');
  maybeFinishSetup(s);
}

function maybeFinishSetup(s: GameState) {
  if (!s.setupDone.defender || !s.setupDone.warlord) return;
  const d = s.setupHidden.defender!;
  const militia = d.slice(0, RULES.startingTroops.defender.militia);
  const knightLane = d[militia.length];
  for (const l of militia) addTroop(s, 'defender', 'militia', l, 'bailey');
  s.knight.lane = knightLane;
  const w = s.setupHidden.warlord!;
  s.approaches[w.camp][0] = { uid: uid(s), buildingId: 'main_siege_camp' };
  for (const l of w.footmen) addTroop(s, 'warlord', 'footmen', l, 'approach');
  log(s, `Reveal! Militia: ${militia.map(laneName).join(', ')}. The Knight stands in the ${laneName(knightLane)} bailey.`);
  log(s, `Reveal! Main Siege Camp in the ${laneName(w.camp)} approach; Footmen: ${w.footmen.map(laneName).join(', ')}.`);
  s.setupHidden = {};
  s.phase = 'build';
  startRound(s);
}

// ---------------- Round flow ----------------

export function collect(s: GameState) {
  for (const side of ['defender', 'warlord'] as Side[]) {
    const inc = incomeFor(s, side);
    addRes(s.stock[side], inc);
    log(s, `Collect: ${side === 'defender' ? 'Defenders' : 'Warlord'} gain ${fmtRes(inc)}.`);
  }
  if (s.harassed.length) s.harassed = [];
}

export function startRound(s: GameState) {
  s.round += 1;
  log(s, `══ Build round ${s.round}${s.finalBuildRound ? ' (final build round — the Warlord makes no moves)' : ''} ══`, 'all', 'round');
  collect(s);
  s.turn = { done: [], current: null, actionsLeft: 0, warlordActionsLeft: 0, abilityUsed: {}, returnStep: null };
  s.step = 'chooseCharacter';
}

export function chooseCharacter(s: GameState, c: CharacterId) {
  if (s.step !== 'chooseCharacter') fail('Not choosing a character now');
  if (!CHARACTERS.includes(c)) fail('Unknown character');
  if (s.turn.done.includes(c)) fail(`${CHARACTER_DEFS[c].name} already acted this round`);
  s.turn.current = c;
  s.turn.actionsLeft = RULES.defenderActionsPerTurn;
  s.step = 'defenderTurn';
  log(s, `— ${CHARACTER_DEFS[c].name}'s turn —`, 'all', 'turn');
}

function endDefenderTurn(s: GameState) {
  const c = s.turn.current!;
  s.turn.done.push(c);
  s.turn.current = null;
  s.turn.actionsLeft = 0;
  if (s.finalBuildRound) return afterWarlordTurn(s);
  s.turn.warlordActionsLeft = RULES.warlordActionsPerDefenderTurn;
  s.step = 'warlordTurn';
}

function afterWarlordTurn(s: GameState) {
  s.turn.warlordActionsLeft = 0;
  if (s.turn.done.length < CHARACTERS.length) {
    s.step = 'chooseCharacter';
    return;
  }
  endRound(s);
}

function endRound(s: GameState) {
  if (overSupplied(s))
    log(s, `Supply check: ${warlordTroopCount(s)} troops exceed Supply Rating ${supplyRating(s)} — every Warlord troop has −1 Strength.`);
  if (s.finalBuildRound) return startSiege(s);
  if (s.round >= RULES.warHorns.latestRound) {
    log(s, 'The Warlord can wait no longer.');
    return soundHorns(s);
  }
  if (s.round >= RULES.warHorns.earliestRound) {
    s.step = 'hornsDecision';
    return;
  }
  startRound(s);
}

export function soundHorns(s: GameState) {
  s.hornsSounded = true;
  s.finalBuildRound = true;
  s.stats.hornsRound = s.round;
  log(s, `📯 WAR HORNS! The Warlord sounds the attack after round ${s.round}. Defenders get one final build round.`, 'all', 'horns');
  startRound(s);
}

export function consumeAction(s: GameState, actor: Actor) {
  if (actor === 'warlord') {
    s.turn.warlordActionsLeft -= 1;
    if (s.turn.warlordActionsLeft <= 0) afterWarlordTurn(s);
  } else {
    s.turn.actionsLeft -= 1;
    if (s.turn.actionsLeft <= 0) endDefenderTurn(s);
  }
}

export function assertActor(s: GameState, actor: Actor) {
  if (s.phase !== 'build') fail('Only during the Build Phase');
  if (actor === 'warlord') {
    if (s.step !== 'warlordTurn') fail("It's not the Warlord's turn");
  } else {
    if (s.step !== 'defenderTurn' || s.turn.current !== actor) fail(`It's not the ${CHARACTER_DEFS[actor].name}'s turn`);
  }
}

export function endTurn(s: GameState, actor: Actor) {
  assertActor(s, actor);
  if (actor === 'warlord') {
    log(s, 'Warlord passes.');
    afterWarlordTurn(s);
  } else {
    log(s, `${ACTOR_NAME(actor)} ends their turn.`);
    endDefenderTurn(s);
  }
}

// ---------------- Building ----------------

export function slotContents(s: GameState, slot: SlotRef): string | null {
  switch (slot.kind) {
    case 'bailey': return s.baileys[slot.lane][slot.index]?.buildingId ?? null;
    case 'approach': return s.approaches[slot.lane][slot.index]?.buildingId ?? null;
    case 'tower': return s.towers[slot.corner]?.buildingId ?? null;
    case 'wall': return s.walls[slot.lane].buildingId;
    case 'gate': return s.gates[slot.lane].buildingId;
    case 'moat': return s.moats[slot.lane] ? 'moat' : null;
  }
}

export function buildCost(actor: Actor, buildingId: string): Resources {
  const def = building(buildingId);
  let cost = { ...def.cost };
  const passive = actor !== 'warlord' ? CHARACTER_DEFS[actor].passive : undefined;
  if (passive?.type === 'structureDiscount' && passive.categories?.includes(def.category))
    cost = discount(cost, passive.resource, passive.amount);
  return cost;
}

export function slotLabel(slot: SlotRef): string {
  switch (slot.kind) {
    case 'bailey': return `${laneName(slot.lane)} bailey slot ${slot.index + 1}`;
    case 'approach': return `${laneName(slot.lane)} approach slot ${slot.index + 1}`;
    case 'tower': return `${slot.corner} tower`;
    case 'wall': return `${laneName(slot.lane)} wall`;
    case 'gate': return `${laneName(slot.lane)} gate`;
    case 'moat': return `${laneName(slot.lane)} moat`;
  }
}

export function doBuild(s: GameState, a: Extract<Action, { type: 'build' }>) {
  assertActor(s, a.actor);
  const side = sideOf(a.actor);
  const def = building(a.buildingId);
  if (def.side !== side) fail(`${def.name} is not a ${side} building`);
  if (def.buildable === false) fail(`${def.name} can't be built`);
  const slot = a.slot;
  const slotKind = slot.kind;
  if (side === 'warlord' && slotKind !== 'approach') fail('The Warlord builds only in the outer approaches');
  if (side === 'defender' && slotKind === 'approach') fail('Defenders cannot build in the approaches');
  if (def.slot !== slotKind) fail(`${def.name} doesn't go in a ${slotKind} slot`);
  if ('index' in slot) {
    const n = (slotKind === 'bailey' ? MAP.baileySlots : MAP.approachSlots)[slot.lane];
    if (slot.index < 0 || slot.index >= n) fail('No such slot');
  }
  const current = slotContents(s, slot);
  if (def.upgradeOf) {
    if (current !== def.upgradeOf) fail(`${def.name} must upgrade a ${building(def.upgradeOf).name}`);
  } else if (current) {
    fail(`That slot already holds ${building(current).name}`);
  }
  if (def.chooseTroopType) {
    if (!a.troopType || troopDef(a.troopType).side !== 'defender') fail('Choose a defender troop type for the Weaponsmith');
  }
  if (def.firstInMainCampLane && countBuilding(s, 'warlord', def.id) === 0 && 'lane' in slot && slot.lane !== mainCampLane(s))
    fail(`The first ${def.name} must be built in the Main Siege Camp's approach`);

  const cost = buildCost(a.actor, def.id);
  pay(s.stock[side], cost, def.name);

  switch (slot.kind) {
    case 'bailey':
    case 'approach': {
      const arr = slot.kind === 'bailey' ? s.baileys[slot.lane] : s.approaches[slot.lane];
      const prev = arr[slot.index];
      arr[slot.index] = { uid: prev?.uid ?? uid(s), buildingId: def.id, ...(a.troopType ? { troopType: a.troopType } : {}) };
      break;
    }
    case 'tower': {
      const prev = s.towers[slot.corner];
      const hp = def.tower!.hp;
      const damage = prev ? prev.maxHp - prev.hp : 0;
      s.towers[slot.corner] = { uid: prev?.uid ?? uid(s), buildingId: def.id, hp: hp - damage, maxHp: hp };
      break;
    }
    case 'wall':
    case 'gate': {
      const st = slot.kind === 'wall' ? s.walls[slot.lane] : s.gates[slot.lane];
      const damage = st.maxHp - st.hp;
      st.buildingId = def.id;
      st.maxHp = def.structure!.hp;
      st.hp = Math.max(1, st.maxHp - damage);
      break;
    }
    case 'moat':
      s.moats[slot.lane] = true;
      break;
  }
  const extra = a.troopType ? ` (${troopDef(a.troopType).name} +1 Strength)` : '';
  log(s, `${ACTOR_NAME(a.actor)} ${def.upgradeOf ? 'upgrades to' : 'builds'} ${def.name}${extra} at ${slotLabel(slot)} for ${fmtRes(cost)}.`);
  consumeAction(s, a.actor);
}

// ---------------- Draft ----------------

export function draftInfo(side: Side, deck: string): { cost: Resources; requires?: string } {
  return (RULES.draftCosts as any)[side][deck];
}

export function doDraft(s: GameState, a: Extract<Action, { type: 'draft' }>) {
  assertActor(s, a.actor);
  const side = sideOf(a.actor);
  const info = draftInfo(side, a.deck);
  if (!info) fail(`No ${a.deck} deck for ${side}`);
  if (info.requires && !hasBuilding(s, side, info.requires)) fail(`The ${cap(a.deck)} deck requires a ${building(info.requires).name}`);
  const deck = s.draftDecks[side][a.deck];
  if (!deck || deck.length === 0) fail(`The ${cap(a.deck)} deck is empty`);
  pay(s.stock[side], info.cost, `drafting ${a.deck}`);
  const cards = deck.splice(0, Math.min(RULES.draftDrawCount, deck.length));
  s.pendingDraft = { actor: a.actor, deck: a.deck, cards };
  s.turn.returnStep = s.step as any;
  s.step = 'draftPick';
  log(s, `${ACTOR_NAME(a.actor)} drafts from the ${cap(a.deck)} deck (${fmtRes(info.cost)}).`);
}

export function doDraftPick(s: GameState, a: Extract<Action, { type: 'draftPick' }>) {
  const p = s.pendingDraft;
  if (s.step !== 'draftPick' || !p) fail('No draft in progress');
  if (p.actor !== a.actor) fail('Not your draft');
  if (a.index < 0 || a.index >= p.cards.length) fail('Pick one of the drawn cards');
  const kept = p.cards[a.index];
  const rest = p.cards.filter((_, i) => i !== a.index);
  s.siegeDecks[p.actor].push(kept);
  s.draftDecks[sideOf(p.actor)][p.deck].push(...rest);
  s.stats.drafted[kept] = (s.stats.drafted[kept] ?? 0) + 1;
  s.pendingDraft = null;
  s.step = s.turn.returnStep ?? 'defenderTurn';
  s.turn.returnStep = null;
  const side = sideOf(p.actor);
  log(s, `${ACTOR_NAME(p.actor)} keeps a card into their siege deck.`);
  log(s, `${ACTOR_NAME(p.actor)} kept ${card(kept).name}.`, side);
  consumeAction(s, p.actor);
}

// ---------------- Troops ----------------

export function trainCost(actor: Actor, troop: string): Resources {
  let cost = { ...troopDef(troop).cost };
  const passive = actor !== 'warlord' ? CHARACTER_DEFS[actor].passive : undefined;
  if (passive?.type === 'trainDiscount') cost = discount(cost, passive.resource, passive.amount);
  return cost;
}

export function doTrain(s: GameState, a: Extract<Action, { type: 'train' }>) {
  assertActor(s, a.actor);
  const t = troopDef(a.troop);
  if (t.side !== 'defender') fail(`${t.name} is not a defender troop`);
  if (t.requires && !hasBuilding(s, 'defender', t.requires)) fail(`${t.name} requires a ${building(t.requires).name}`);
  if (!LANES.includes(a.lane)) fail('Choose a bailey');
  if (garrisonRoom(s) <= 0)
    fail(`The garrison is full (${defenderTroopCount(s)}/${garrisonCapacity(s)}). Build a Barracks to house more troops.`);
  const cost = trainCost(a.actor, a.troop);
  pay(s.stock.defender, cost, t.name);
  addTroop(s, 'defender', a.troop, a.lane, 'bailey');
  log(s, `${ACTOR_NAME(a.actor)} trains ${t.name} in the ${laneName(a.lane)} bailey (${fmtRes(cost)}).`);
  consumeAction(s, a.actor);
}

export function recruitCost(s: GameState, troop: string, lane: Lane): Resources {
  let cost = { ...troopDef(troop).cost };
  for (const b of s.approaches[lane]) {
    const d = b && building(b.buildingId).recruitDiscount;
    if (d) for (const [k, v] of Object.entries(d)) cost = discount(cost, k, v);
  }
  return cost;
}

export function doRecruit(s: GameState, a: Extract<Action, { type: 'recruit' }>) {
  assertActor(s, 'warlord');
  const t = troopDef(a.troop);
  if (t.side !== 'warlord') fail(`${t.name} is not a Warlord troop`);
  if (t.requires && !hasBuilding(s, 'warlord', t.requires)) fail(`${t.name} requires a ${building(t.requires).name}`);
  if (!s.approaches[a.lane].some((b) => b && building(b.buildingId).recruitHere))
    fail('Recruit only in an approach with a Siege Camp or War Camp');
  const max = RULES.recruitPerAction ?? 1;
  const n = a.count ?? 1;
  if (!Number.isInteger(n) || n < 1 || n > max) fail(`Recruit 1–${max} troops per action`);
  const one = recruitCost(s, a.troop, a.lane);
  const cost: Resources = {};
  for (const [k, v] of Object.entries(one)) cost[k] = v * n;
  pay(s.stock.warlord, cost, `${n} ${t.name}`);
  for (let i = 0; i < n; i++) addTroop(s, 'warlord', a.troop, a.lane, 'approach');
  log(s, `Warlord recruits ${n} ${t.name} in the ${laneName(a.lane)} approach (${fmtRes(cost)}).`);
  consumeAction(s, 'warlord');
}

export function doMove(s: GameState, a: Extract<Action, { type: 'move' }>) {
  assertActor(s, a.actor);
  if (!adjacent(a.from, a.to)) fail('Troops move only between adjacent baileys');
  const here = defendersIn(s, a.from);
  const ids = a.troopUids ?? here.map((t) => t.uid);
  const moving = here.filter((t) => ids.includes(t.uid));
  if (ids.length !== moving.length) fail('Some of those troops are not in that bailey');
  const knight = !!a.includeKnight;
  if (knight && s.knight.lane !== a.from) fail('The Knight is not in that bailey');
  if (!moving.length && !knight) fail('Nothing to move');
  for (const t of moving) t.lane = a.to;
  if (knight) s.knight.lane = a.to;
  log(s, `${ACTOR_NAME(a.actor)} moves ${moving.length} troop(s)${knight ? ' and the Knight' : ''} from the ${laneName(a.from)} to the ${laneName(a.to)} bailey.`);
  consumeAction(s, a.actor);
}

export function doMarch(s: GameState, a: Extract<Action, { type: 'march' }>) {
  assertActor(s, 'warlord');
  if (!adjacent(a.from, a.to)) fail('March only to an adjacent approach');
  const here = troopsAt(s, 'warlord', a.from, 'approach');
  const moving = here.filter((t) => a.troopUids.includes(t.uid));
  if (!moving.length || moving.length !== a.troopUids.length) fail('Choose troops in that approach');
  if (moving.length > RULES.marchMaxTroops) fail(`March at most ${RULES.marchMaxTroops} troops`);
  const free = moving.every((t) => troopDef(t.type).freeMarch);
  const cost = free ? {} : RULES.marchCost;
  pay(s.stock.warlord, cost, 'march');
  for (const t of moving) t.lane = a.to;
  log(s, `Warlord marches ${moving.length} troop(s) from the ${laneName(a.from)} to the ${laneName(a.to)} approach${free ? ' (Raiders march free)' : ''}.`);
  consumeAction(s, 'warlord');
}

// ---------------- Economy ----------------

function resList(side: Side): readonly string[] {
  return side === 'defender' ? DEFENDER_RES : WARLORD_RES;
}

export function doTrade(s: GameState, a: Extract<Action, { type: 'trade' }>) {
  assertActor(s, a.actor);
  const side = sideOf(a.actor);
  const list = resList(side);
  if (!list.includes(a.give) || !list.includes(a.get) || a.give === a.get) fail('Invalid trade');
  pay(s.stock[side], { [a.give]: RULES.tradeRate }, 'trade');
  addRes(s.stock[side], { [a.get]: 1 });
  log(s, `${ACTOR_NAME(a.actor)} trades ${RULES.tradeRate} ${cap(a.give)} for 1 ${cap(a.get)}.`);
  consumeAction(s, a.actor);
}

function useAbility(s: GameState, c: CharacterId, ability: string) {
  if (CHARACTER_DEFS[c].ability !== ability) fail(`${CHARACTER_DEFS[c].name} doesn't have ${ability}`);
  if (s.turn.abilityUsed[c]) fail(`${cap(ability)} was already used this round`);
  s.turn.abilityUsed[c] = true;
}

export function doDecree(s: GameState, a: Extract<Action, { type: 'decree' }>) {
  assertActor(s, a.actor);
  if (!DEFENDER_RES.includes(a.resource as any)) fail('Invalid resource');
  useAbility(s, 'lord', 'decree');
  addRes(s.stock.defender, { [a.resource]: RULES.decreeAmount });
  log(s, `Lord's Decree: +${RULES.decreeAmount} ${cap(a.resource)}.`);
  consumeAction(s, 'lord');
}

export function doRequisition(s: GameState, a: Extract<Action, { type: 'requisition' }>) {
  assertActor(s, a.actor);
  if (!DEFENDER_RES.includes(a.give as any) || !DEFENDER_RES.includes(a.get as any) || a.give === a.get) fail('Invalid requisition');
  if (a.amount < 1 || a.amount > RULES.requisitionMax) fail(`Requisition 1–${RULES.requisitionMax}`);
  if (!canAfford(s.stock.defender, { [a.give]: a.amount })) fail('Not enough resources');
  useAbility(s, 'quartermaster', 'requisition');
  pay(s.stock.defender, { [a.give]: a.amount });
  addRes(s.stock.defender, { [a.get]: a.amount });
  log(s, `Quartermaster requisitions ${a.amount} ${cap(a.give)} → ${a.amount} ${cap(a.get)}.`);
  consumeAction(s, 'quartermaster');
}

// ---------------- Raid & Harass ----------------

export function doRaid(s: GameState, a: Extract<Action, { type: 'raid' }>) {
  assertActor(s, a.actor);
  if (a.actor !== 'knight') fail('Only the Knight can raid');
  if (s.knight.hp <= 0) fail('The Knight is not fit to ride');
  const party = defendersIn(s, a.lane).filter((t) => a.troopUids.includes(t.uid));
  if (party.length !== a.troopUids.length) fail(`Raiding troops must be in the ${laneName(a.lane)} bailey`);
  if (party.length > RULES.raid.maxTroops) fail(`At most ${RULES.raid.maxTroops} troops join a raid`);
  useAbility(s, 'knight', 'raid');
  s.knight.lane = a.lane;
  const raidStr = RULES.raid.knightStrength + sumStrength(s, party);
  const enemies = troopsAt(s, 'warlord', a.lane, 'approach');
  const guards = s.approaches[a.lane].filter(Boolean).length * (RULES.raid.guardPerBuilding ?? 0);
  const enemyStr = sumStrength(s, enemies) + guards;
  log(s, `⚔ The Knight raids the ${laneName(a.lane)} approach with ${party.length} troop(s): Strength ${raidStr} vs ${enemyStr}${guards ? ` (incl. ${guards} camp guards)` : ''}.`);
  if (raidStr > enemyStr) {
    s.stats.raids.won++;
    const targets = s.approaches[a.lane]
      .map((b, i) => ({ b, i }))
      .filter((x) => x.b && !building(x.b.buildingId).indestructible);
    const chosen = targets.find((x) => x.b!.uid === a.targetBuildingUid) ?? targets[0];
    if (chosen) {
      log(s, `Raid succeeds! ${building(chosen.b!.buildingId).name} is burned.`);
      s.approaches[a.lane][chosen.i] = null;
    } else log(s, 'Raid succeeds, but there is nothing to burn.');
    const w = weakest(s, enemies);
    if (w) { removeTroop(s, w); log(s, `The Warlord loses ${troopDef(w.type).name}.`); }
  } else {
    s.stats.raids.lost++;
    const w = weakest(s, party);
    if (w) { removeTroop(s, w); log(s, `Raid repelled! The raiders lose ${troopDef(w.type).name}.`); }
    else log(s, 'Raid repelled!');
    const g = s.gates[a.lane];
    const before = g.hp;
    g.hp = Math.max(1, g.hp - RULES.raid.gateDamageOnFail);
    log(s, `The open ${laneName(a.lane)} gate takes ${before - g.hp} damage (${g.hp}/${g.maxHp}).`);
  }
  consumeAction(s, 'knight');
}

export function doHarass(s: GameState, a: Extract<Action, { type: 'harass' }>) {
  assertActor(s, 'warlord');
  if (troopsAt(s, 'warlord', a.lane, 'approach').length < RULES.harassMinTroops)
    fail(`Harass needs at least ${RULES.harassMinTroops} troops in that approach`);
  const prod = s.baileys[a.lane].filter((b) => b && building(b.buildingId).produces && !s.harassed.includes(b.uid));
  if (!prod.length) fail('No defender production building to harass in that bailey');
  const target = prod.find((b) => b!.uid === a.buildingUid) ?? prod[0]!;
  pay(s.stock.warlord, RULES.harassCost, 'harass');
  s.harassed.push(target.uid);
  log(s, `Warlord harasses the ${laneName(a.lane)} bailey: ${building(target.buildingId).name} produces nothing next Collect.`);
  consumeAction(s, 'warlord');
}

// ---------------- Horns ----------------

export function doHornsDecision(s: GameState, sound: boolean) {
  if (s.step !== 'hornsDecision') fail('Not deciding on the War Horns now');
  if (sound) soundHorns(s);
  else { log(s, 'The Warlord bides their time.'); startRound(s); }
}

export function debugSkipToHorns(s: GameState) {
  if (s.phase !== 'build') fail('Only during the Build Phase');
  if (s.hornsSounded) fail('Horns already sounded');
  log(s, '[debug] Jumping to the War Horns.');
  soundHorns(s);
}


