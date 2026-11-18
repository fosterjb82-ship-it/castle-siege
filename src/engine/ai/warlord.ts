import { MAP, RULES, building, card } from '../data';
import { allSlots, isLegal } from '../engine';
import { canUseFallback, handSize } from '../siege';
import type { Action, CardPlanInput, GameState, Lane, SlotRef, StructureKind } from '../types';
import { CHARACTERS, LANES } from '../types';
import {
  cornersCovering, countBuilding, hasBuilding, mainCampLane, supplyRating, totalDefenderStrength,
  totalWarlordStrength, troopsAt, warlordTroopCount,
} from '../util';
import { aiRng, warlordTargetLane } from './common';

function firstLegal(s: GameState, actions: Action[]): Action | null {
  for (const a of actions) if (isLegal(s, a)) return a;
  return null;
}

function emptySlots(s: GameState, lane: Lane): SlotRef[] {
  return s.approaches[lane].map((b, i) => (b ? null : ({ kind: 'approach', lane, index: i } as SlotRef))).filter(Boolean) as SlotRef[];
}

function buildIn(s: GameState, id: string, preferLanes: Lane[]): Action[] {
  const lanes = [...preferLanes, ...LANES.filter((l) => !preferLanes.includes(l))];
  return lanes.flatMap((l) => emptySlots(s, l).map((slot) => ({ type: 'build', actor: 'warlord', slot, buildingId: id }) as Action));
}

function upgrade(s: GameState, from: string, to: string): Action[] {
  return allSlots('warlord')
    .filter((sl) => sl.kind === 'approach' && s.approaches[sl.lane][sl.index]?.buildingId === from)
    .map((slot) => ({ type: 'build', actor: 'warlord', slot, buildingId: to }) as Action);
}

function recruitLanes(s: GameState, target: Lane): Lane[] {
  const ok = LANES.filter((l) => s.approaches[l].some((b) => b && building(b.buildingId).recruitHere));
  return ok.sort((a, b) => (a === target ? -1 : b === target ? 1 : 0) || (MAP.adjacency[target].includes(a) ? -1 : 1));
}

function recruitActions(s: GameState, target: Lane): Action[] {
  const out: Action[] = [];
  const types = ['veterans', 'raiders', 'crossbowmen', 'footmen'];
  const max = RULES.recruitPerAction ?? 1;
  const space = Math.max(1, supplyRating(s) - warlordTroopCount(s));
  for (const t of types) for (const l of recruitLanes(s, target))
    for (let n = Math.min(max, space); n >= 1; n--) out.push({ type: 'recruit', troop: t, lane: l, count: n });
  return out;
}

function marchActions(s: GameState, target: Lane): Action[] {
  const out: Action[] = [];
  for (const from of MAP.adjacency[target]) {
    const here = troopsAt(s, 'warlord', from, 'approach');
    if (here.length) out.push({ type: 'march', from, to: target, troopUids: here.slice(0, RULES.marchMaxTroops).map((t) => t.uid) });
  }
  // Opposite lane: march one step toward the target.
  for (const from of LANES) {
    if (from === target || MAP.adjacency[target].includes(from)) continue;
    const here = troopsAt(s, 'warlord', from, 'approach');
    if (!here.length) continue;
    const via = MAP.adjacency[from].find((x) => MAP.adjacency[target].includes(x))!;
    out.push({ type: 'march', from, to: via, troopUids: here.slice(0, RULES.marchMaxTroops).map((t) => t.uid) });
  }
  return out;
}

function tradeFor(s: GameState, need: string): Action[] {
  const st = s.stock.warlord;
  return (['supplies', 'timber', 'gold'] as const)
    .filter((r) => r !== need && (st[r] ?? 0) >= RULES.tradeRate + 2)
    .map((give) => ({ type: 'trade', actor: 'warlord', give, get: need }) as Action);
}

export function warlordCardValue(s: GameState, cardId: string, target: Lane): number {
  const c = card(cardId);
  const moat = s.moats[target];
  switch (c.id) {
    case 'battering_ram': return moat ? 2 : 7.5;
    case 'catapult': return coveringTowers(s, target) ? 6.5 : 2.5;
    case 'siege_tower': return moat ? 4 : 6.5; // shelter still works behind a moat
    case 'trebuchet': return 6;
    case 'ladders': return 4;
    case 'sappers': return 5;
    case 'footmen_wave': return 6;
    case 'raider_band': return 6;
    case 'crossbow_line': return 5;
    case 'veteran_company': return hasBuilding(s, 'warlord', 'veteran_camp') ? 6 : 2;
    case 'volley': return 4;
    case 'bribe_the_guard': return 4;
    case 'bridge': return moat ? 5 : 1;
    case 'decoy_banners': return 1.5;
    case 'spy_in_the_walls': return 1;
    case 'advance': return 2;
    default:
      if (c.laneRule === target) return 6.5;
      if (c.laneRule !== 'any') return 3;
      return 2;
  }
}

export function warlordAI(s: GameState): Action {
  const rnd = aiRng(s, 99);
  if (s.step === 'setup') {
    const camp = LANES[Math.floor(rnd() * 4)];
    const other = MAP.adjacency[camp][Math.floor(rnd() * 2)];
    return { type: 'setupWarlord', camp, footmen: [camp, camp, other] };
  }
  if (s.step === 'draftPick') {
    const p = s.pendingDraft!;
    const target = warlordTargetLane(s);
    let best = 0;
    p.cards.forEach((c, i) => { if (warlordCardValue(s, c, target) > warlordCardValue(s, p.cards[best], target)) best = i; });
    return { type: 'draftPick', actor: 'warlord', index: best };
  }
  if (s.step === 'hornsDecision') {
    const ready = totalWarlordStrength(s) >= totalDefenderStrength(s) + RULES.ai.hornsStrengthMargin
      || s.round >= RULES.ai.hornsByRound;
    return ready ? { type: 'soundHorns' } : { type: 'holdHorns' };
  }
  if (s.step === 'siege') return warlordSiegePlan(s);
  return warlordBuildAction(s);
}

function deckCount(s: GameState, pred: (id: string) => boolean): number {
  return [...s.siegeDecks.warlord, ...s.hands.warlord].filter(pred).length;
}

function warlordBuildAction(s: GameState): Action {
  const rnd = aiRng(s, 13);
  const target = warlordTargetLane(s);
  const main = mainCampLane(s) ?? target;
  const guarded = (l: Lane) => troopsAt(s, 'warlord', l, 'approach').length;
  const others = LANES.filter((l) => l !== main).sort((a, b) => guarded(b) - guarded(a));
  const st = s.stock.warlord;
  const needWorkshop = !hasBuilding(s, 'warlord', 'siege_workshop');
  // Keep a slot in the main camp's approach for the first Siege Workshop.
  const econLanes = needWorkshop ? others : [main, ...others];
  const rating = supplyRating(s);
  const troops = warlordTroopCount(s);
  const room = troops < rating;
  const engines = deckCount(s, (c) => card(c).deck === 'engines');
  const troopCards = deckCount(s, (c) => card(c).deck === 'troops');
  const tactics = deckCount(s, (c) => card(c).deck === 'tactics');
  const economy = s.round <= RULES.ai.economyRounds;
  const list: Action[] = [];

  // Essentials
  if (needWorkshop && s.round >= 2) list.push(...buildIn(s, 'siege_workshop', [main]));
  if (!hasBuilding(s, 'warlord', 'war_camp') && s.round >= 2) list.push(...buildIn(s, 'war_camp', econLanes));
  // Drafting quota: about two siege cards per build round from round 2.
  const deckSize = s.siegeDecks.warlord.length + s.hands.warlord.length;
  const wantDeck = 3 + Math.max(0, s.round - 1) * 2;
  if (deckSize < wantDeck) {
    if (engines < 5) list.push({ type: 'draft', actor: 'warlord', deck: 'engines' });
    if (troopCards < 5) list.push({ type: 'draft', actor: 'warlord', deck: 'troops' });
    if (tactics < 4) list.push({ type: 'draft', actor: 'warlord', deck: 'tactics' });
  }
  if (economy) {
    if (countBuilding(s, 'warlord', 'supply_line') < 1) list.push(...buildIn(s, 'supply_line', econLanes));
    if (countBuilding(s, 'warlord', 'foraging_camp') < 1) list.push(...buildIn(s, 'foraging_camp', econLanes));
  }
  // Grow the army: more Supply Rating when capped, then recruit.
  if (troops >= rating - 1 && (st.supplies ?? 0) >= 4 && (s.round >= 3 || hasBuilding(s, 'warlord', 'siege_workshop')))
    list.push(...buildIn(s, 'siege_camp', [target, ...econLanes]));
  if (room && (rnd() < 0.7 || !economy)) list.push(...recruitActions(s, target));
  // Siege deck
  if (!economy || rnd() < 0.45) {
    if (engines < 4) list.push({ type: 'draft', actor: 'warlord', deck: 'engines' });
    if (troopCards < 4 && (st.supplies ?? 0) >= 4) list.push({ type: 'draft', actor: 'warlord', deck: 'troops' });
    if (tactics < 3) list.push({ type: 'draft', actor: 'warlord', deck: 'tactics' });
  }
  if (economy) {
    if (countBuilding(s, 'warlord', 'supply_line') < 2) list.push(...buildIn(s, 'supply_line', econLanes));
    if (countBuilding(s, 'warlord', 'foraging_camp') < 2) list.push(...buildIn(s, 'foraging_camp', econLanes));
  }
  // Concentrate on the target lane.
  list.push(...marchActions(s, target));
  if (s.round >= 4 && !hasBuilding(s, 'warlord', 'veteran_camp')) list.push(...upgrade(s, 'war_camp', 'veteran_camp'));
  if (countBuilding(s, 'warlord', 'command_tent') < 1 && !economy) list.push(...buildIn(s, 'command_tent', econLanes));
  if (countBuilding(s, 'warlord', 'staging_ground') < 1 && !economy) list.push(...buildIn(s, 'staging_ground', [target]));
  if (room) list.push(...recruitActions(s, target));
  list.push(...buildIn(s, 'siege_camp', econLanes));
  if (troopCards < 8) list.push({ type: 'draft', actor: 'warlord', deck: 'troops' });
  if (engines < 6) list.push({ type: 'draft', actor: 'warlord', deck: 'engines' });
  for (const l of LANES) list.push({ type: 'harass', lane: l });
  list.push({ type: 'draft', actor: 'warlord', deck: 'tactics' });
  const a = firstLegal(s, list);
  if (a) return a;
  const t = firstLegal(s, [...tradeFor(s, 'gold'), ...tradeFor(s, 'timber'), ...tradeFor(s, 'supplies')]);
  return t ?? { type: 'endTurn', actor: 'warlord' };
}

function bestAssaultTarget(s: GameState, lane: Lane): StructureKind {
  const g = s.gates[lane], w = s.walls[lane];
  const gScore = building(g.buildingId).structure!.defense * 2 + g.hp;
  const wScore = building(w.buildingId).structure!.defense * 2 + w.hp;
  return wScore < gScore ? 'wall' : 'gate';
}

function warlordSiegePlan(s: GameState): Action {
  const rnd = aiRng(s, 7);
  const target = warlordTargetLane(s);
  const need = RULES.warlordCardsPerRound;
  const hand = [...s.hands.warlord];
  const ranked = hand.map((c) => ({ c, v: warlordCardValue(s, c, target) })).sort((a, b) => b.v - a.v);
  const cards: CardPlanInput[] = [];
  const feintLane = LANES.filter((l) => l !== target)[Math.floor(rnd() * 3)];
  const used = new Set<number>();
  const take = (pred: (c: string) => boolean) => {
    const i = ranked.findIndex((x, j) => !used.has(j) && pred(x.c));
    if (i >= 0) used.add(i);
    return i >= 0 ? ranked[i].c : null;
  };
  const fitsLane = (c: string, l: Lane) => { const r = card(c).laneRule; return r === 'any' || r === 'none' || r === l; };
  // Two strongest cards on the target lane.
  for (let k = 0; k < 2; k++) {
    const c = take((x) => fitsLane(x, target) && x !== 'decoy_banners' && x !== 'spy_in_the_walls');
    if (c) cards.push(planCard(s, c, target));
  }
  // Feint: Decoy, Spy, or a directional card for its own lane.
  const feint = take((x) => x === 'decoy_banners' || x === 'spy_in_the_walls')
    ?? take((x) => card(x).laneRule !== 'any' && card(x).laneRule !== target)
    ?? take(() => true);
  if (feint) {
    const r = card(feint).laneRule;
    cards.push(planCard(s, feint, r !== 'any' && r !== 'none' ? (r as Lane) : feintLane));
  }
  while (cards.length < need) {
    const c = take((x) => fitsLane(x, target));
    if (c) { cards.push(planCard(s, c, target)); continue; }
    const any = take(() => true);
    if (any) { const r = card(any).laneRule; cards.push(planCard(s, any, r !== 'any' && r !== 'none' ? (r as Lane) : feintLane)); continue; }
    if (canUseFallback(s, 'warlord')) cards.push({ cardId: RULES.fallbackCard.warlord, lane: target, target: bestAssaultTarget(s, target), fallback: true });
    else break;
  }
  const moves = LANES.filter((l) => s.breached[l]).map((l) => ({
    from: l, to: l, troopUids: troopsAt(s, 'warlord', l, 'approach').map((t) => t.uid),
  })).filter((m) => m.troopUids.length);
  void handSize; void CHARACTERS;
  return { type: 'planSiege', actor: 'warlord', cards: cards.slice(0, need), moves };
}

function coveringTowers(s: GameState, lane: Lane): number {
  return cornersCovering(lane).filter((c) => s.towers[c]).length;
}

function planCard(s: GameState, cardId: string, lane: Lane): CardPlanInput {
  const c = card(cardId);
  const p: CardPlanInput = { cardId, lane };
  if (c.target === 'any') p.target = bestAssaultTarget(s, lane);
  const eng = c.effects.find((e) => e.type === 'engine');
  if (eng?.canHitTowers) p.target = eng.target === 'tower' && coveringTowers(s, lane) ? 'tower' : 'wall';
  if (c.effects.some((e) => e.type === 'peekHand')) p.spyTarget = CHARACTERS[(s.log.length + lane.charCodeAt(0)) % 4];
  return p;
}
