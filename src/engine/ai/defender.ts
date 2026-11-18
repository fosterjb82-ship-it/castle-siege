import { RULES, building, card, troopDef } from '../data';
import { legalBuildActions } from '../engine';
import { canUseFallback, cardPlayError, knightAvailable } from '../siege';
import type { AbilityPlan, Action, CardPlanInput, CharacterId, GameState, Lane } from '../types';
import { CHARACTERS, LANES } from '../types';
import {
  apparentWarlordCount, buildingsOf, countBuilding, cornersCovering, defendersIn, garrisonRoom, hasBuilding, incomeFor, mainCampLane, sumStrength, troopsAt,
} from '../util';
import { aiRng, laneThreat, lanesByThreat } from './common';

const ORDER: CharacterId[] = ['lord', 'quartermaster', 'architect', 'knight'];

function productionCount(s: GameState) {
  return buildingsOf(s, 'defender').filter((x) => building(x.b.buildingId).produces).length;
}

/** Food still needed to feed the expected garrison for the whole siege. */
export function foodDeficit(s: GameState): number {
  const expected = Math.max(defendersCount(s), garrisonCapacityOf(s));
  const need = Math.ceil(expected / RULES.food.troopsPerFood) * (s.relief?.roundsLeft ?? RULES.relief.rounds);
  const income = incomeFor(s, 'defender', true).food ?? 0;
  const roundsLeft = s.phase !== 'build' ? 0 : Math.max(1, RULES.ai.hornsByRound - s.round + 1);
  return need - (s.stock.defender.food ?? 0) - income * roundsLeft;
}
const defendersCount = (s: GameState) => s.troops.filter((t) => t.side === 'defender').length;
const garrisonCapacityOf = (s: GameState) => garrisonRoom(s) + defendersCount(s);

function scoreBuild(s: GameState, a: Extract<Action, { type: 'build' }>): number {
  const id = a.buildingId;
  const threat = lanesByThreat(s);
  const top = threat.slice(0, 2);
  const lane = 'lane' in a.slot ? a.slot.lane : null;
  const early = s.round <= 3 && !s.hornsSounded;
  const prod = productionCount(s);
  switch (id) {
    case 'quarry': return prod < 5 && !(s.phase === 'blockade') ? (early ? 7 : 3) - countBuilding(s, 'defender', 'quarry') : -1;
    case 'market': return prod < 5 && !(s.phase === 'blockade') ? (early ? 7.5 : 3) - countBuilding(s, 'defender', 'market') * 1.5 : -1;
    case 'granary': {
      const d = foodDeficit(s);
      return (s.phase === 'blockade') ? -1 : d > 0 ? 6 + Math.min(d, 8) * 0.25 - countBuilding(s, 'defender', 'granary') * 1.5 : 0.5;
    }
    case 'lumber_mill': return prod < 5 && !(s.phase === 'blockade') ? (early ? 6 : 2) - countBuilding(s, 'defender', 'lumber_mill') * 2 : -1;
    case 'barracks': return hasBuilding(s, 'defender', 'barracks') ? -1 : s.round >= 2 || garrisonRoom(s) <= 1 ? 7 : 4;
    case 'garrison_hall': return s.round >= 4 ? 6 : 2;
    case 'weaponsmith': {
      const n = s.troops.filter((t) => t.side === 'defender' && t.type === a.troopType).length;
      return countBuilding(s, 'defender', 'weaponsmith') ? -1 : n >= 3 ? 4 + n * 0.3 : -1;
    }
    case 'arrow_tower': {
      const corner = a.slot.kind === 'tower' ? a.slot.corner : null;
      const covers = corner ? (corner.split('') as Lane[]) : [];
      return 5 + covers.filter((l) => top.includes(l)).length * 1.5 - (early ? 2 : 0);
    }
    case 'stone_tower': return 4.5;
    case 'ironbound_gate': return (lane && top.includes(lane) ? 7 : 4.5) - (early ? 2 : 0);
    case 'gatehouse': return (lane && top.includes(lane) ? 6 : 3.5);
    case 'stone_wall': return (lane && top.includes(lane) ? 6 : 3.5) - (early ? 2 : 0);
    case 'moat': return hasBuilding(s, 'warlord', 'siege_workshop') && lane === threat[0] ? 5.5 : 1.5;
    default: return 0;
  }
}

function troopValue(type: string) {
  return { militia: 3, archers: 4.5, men_at_arms: 5.2, keep_knights: 6 }[type] ?? 2;
}

function defenderCardValue(s: GameState, c: string, actor: CharacterId): number {
  const d = card(c);
  if (d.character && d.character !== actor) return 0;
  const threat = lanesByThreat(s);
  switch (c) {
    case 'shield_wall': return 4.5;
    case 'burning_oil': return hasBuilding(s, 'warlord', 'siege_workshop') ? 5.5 : 3;
    case 'barricade': return 4.5;
    case 'emergency_repairs': return 4.5;
    case 'caltrops': return 3.5;
    case 'murder_holes': return 3.5;
    case 'militia_levy': return 4.5;
    case 'archer_company': return 4.5;
    case 'men_at_arms_detachment': return 4.5;
    case 'knights_of_the_keep': return hasBuilding(s, 'defender', 'garrison_hall') ? 5 : 1;
    case 'scout_report': return 1.5;
    case 'counter_feint': return 2;
    case 'sally_forth': return 3.5;
    default:
      if (d.laneRule !== 'any') return d.laneRule === threat[0] ? 6 : d.laneRule === threat[1] ? 4.5 : 3;
      return 2;
  }
}

function scoreAction(s: GameState, actor: CharacterId, a: Action, rnd: () => number): number {
  const noise = rnd() * 0.6;
  const deck = s.siegeDecks[actor].length;
  switch (a.type) {
    case 'build': return scoreBuild(s, a) + noise;
    case 'train': {
      const lanes = lanesByThreat(s);
      const laneBonus = a.lane === lanes[0] ? 1.2 : a.lane === lanes[1] ? 0.6 : 0;
      const thin = defendersIn(s, a.lane).length === 0 ? 1 : 0;
      const late = s.round >= 4 || (s.phase === 'blockade') ? 1.5 : 0;
      // With little room left in the garrison, spend it on quality troops.
      const room = garrisonRoom(s);
      const quality = room <= 3 && a.troop === 'militia' ? -2.5 : 0;
      return troopValue(a.troop) + laneBonus + thin + late + quality - 2 + noise;
    }
    case 'draft': {
      const base = { tactics: 4.6, fortifications: 5, garrison: 5 }[a.deck] ?? 3;
      const late = s.round >= 4 || (s.phase === 'blockade') ? 1.5 : 0;
      return base + late - Math.max(0, deck - 3) * 0.8 + noise;
    }
    case 'decree': return 6 + (a.resource === 'food' && foodDeficit(s) > 0 ? 1 : 0) + noise;
    case 'trade': return (a.get === 'food' && (s.phase === 'blockade') && foodDeficit(s) > 0 && a.give !== 'food' ? 3.5 : a.give === 'food' ? -1 : 0.3) + noise;
    case 'requisition': return (a.get === 'food' && foodDeficit(s) > 2 ? 3 : a.give === 'food' ? -1 : 0.5) + noise;
    case 'raid': {
      const foes = troopsAt(s, 'warlord', a.lane, 'approach');
      const party = defendersIn(s, a.lane).filter((t) => a.troopUids.includes(t.uid));
      const mine = RULES.raid.knightStrength + sumStrength(s, party);
      const targets = s.approaches[a.lane].filter((b) => b && !building(b.buildingId).indestructible).length;
      const guards = s.approaches[a.lane].filter(Boolean).length * (RULES.raid.guardPerBuilding ?? 0);
      const seen = s.phase === 'blockade'
        ? apparentWarlordCount(s, a.lane) * (foes.length ? sumStrength(s, foes) / foes.length : 1.3)
        : sumStrength(s, foes);
      if (mine <= seen + guards) return -5;
      if (a.targetEngineUid !== undefined) return 7.5 + noise; // burn a siege engine
      return targets ? 6.5 + noise : -5;
    }
    case 'move': return -1;
    case 'repair': {
      const t = lanesByThreat(s);
      const laneW = a.lane === t[0] ? 1.5 : a.lane === t[1] ? 0.7 : 0;
      let dmg = 0;
      if (a.structure === 'tower') dmg = Math.max(0, ...cornersCovering(a.lane).map((c) => s.towers[c] ? s.towers[c]!.maxHp - s.towers[c]!.hp : 0));
      else { const st = a.structure === 'wall' ? s.walls[a.lane] : s.gates[a.lane]; dmg = st.maxHp - st.hp; }
      return dmg >= 2 ? 4.5 + Math.min(dmg, 4) * 0.5 + laneW + noise : dmg === 1 ? 1.5 + noise : -1;
    }
    case 'scout': {
      if (s.blockade?.scouted.includes(a.lane)) return -1;
      // Suspicious lanes: where the visible army is, and where the Warlord might be hiding it.
      const t = lanesByThreat(s);
      return (a.lane === t[0] ? 4.2 : a.lane === t[1] ? 3.6 : 2.2) + noise;
    }
    case 'levy': {
      const fed = foodDeficit(s) <= 0;
      const t = lanesByThreat(s);
      return (fed ? 4.4 : 1.2) + (a.lane === t[0] ? 0.5 : 0) + noise;
    }
    case 'endTurn': return 0.1;
    default: return 0;
  }
}

export function defenderAI(s: GameState, actor: CharacterId): Action {
  const rnd = aiRng(s, actor.length);
  if (s.step === 'setup') {
    const shuffled = [...LANES].sort(() => rnd() - 0.5);
    return { type: 'setupDefenders', militia: shuffled.slice(0, 3), knight: shuffled[0] };
  }
  if (s.step === 'chooseCharacter') {
    const c = ORDER.find((x) => !s.turn.done.includes(x))!;
    return { type: 'chooseCharacter', character: c };
  }
  if (s.step === 'draftPick') {
    const p = s.pendingDraft!;
    let best = 0;
    p.cards.forEach((c, i) => { if (defenderCardValue(s, c, actor) > defenderCardValue(s, p.cards[best], actor)) best = i; });
    return { type: 'draftPick', actor, index: best };
  }
  if (s.step === 'siege') return defenderSiegePlan(s, actor);
  const options = legalBuildActions(s, actor);
  let best: Action = { type: 'endTurn', actor };
  let bestScore = 0.1;
  for (const a of options) {
    const sc = scoreAction(s, actor, a, rnd);
    if (sc > bestScore) { best = a; bestScore = sc; }
  }
  return best;
}

// ---------- Siege ----------

function damageOf(s: GameState, l: Lane) {
  return Math.max(s.walls[l].maxHp - s.walls[l].hp, s.gates[l].maxHp - s.gates[l].hp);
}

function laneForCard(s: GameState, actor: CharacterId, cardId: string): { lane: Lane; value: number } | null {
  const c = card(cardId);
  const threat = lanesByThreat(s);
  const legal = LANES.filter((l) => !cardPlayError(s, actor, c, l));
  if (!legal.length) return null;
  const engineLanes = [...LANES].sort((a, b) => s.engines.filter((e) => e.lane === b).length - s.engines.filter((e) => e.lane === a).length);
  const rank = (l: Lane) => 3 - threat.indexOf(l);
  let pickLane: Lane;
  let value = 1;
  const eff = c.effects.map((e) => e.type);
  if (eff.includes('destroyEngine')) {
    pickLane = legal.find((l) => l === engineLanes[0]) ?? threat[0];
    value = s.engines.some((e) => e.lane === pickLane) ? 7 : 1;
  } else if (eff.includes('repair')) {
    pickLane = [...legal].sort((a, b) => damageOf(s, b) - damageOf(s, a))[0];
    value = Math.min(damageOf(s, pickLane), 3) * 1.8;
  } else if (eff.includes('sallyForth')) {
    pickLane = s.knight.lane ?? threat[0];
    value = 2.5;
  } else if (eff.includes('drawCards')) {
    pickLane = threat[3];
    value = 1.5;
  } else if (eff.includes('peekHand')) {
    pickLane = threat[3];
    value = 1;
  } else {
    pickLane = legal.sort((a, b) => rank(b) - rank(a))[0];
    const amt = c.effects.reduce((a, e) => {
      if (e.type === 'deployTroops') {
        const arrive = Math.min(e.count, e.levy ? s.population ?? 0 : garrisonRoom(s));
        return a + arrive * 1.5;
      }
      return a + (e.amount ?? 0);
    }, 0);
    value = amt + rank(pickLane) * 0.8;
  }
  return { lane: pickLane, value };
}

function defenderSiegePlan(s: GameState, actor: CharacterId): Action {
  const threat = lanesByThreat(s);
  let best: CardPlanInput | null = null;
  let bestV = -Infinity;
  for (const c of new Set(s.hands[actor])) {
    const r = laneForCard(s, actor, c);
    if (r && r.value > bestV) { bestV = r.value; best = { cardId: c, lane: r.lane }; }
  }
  if (best && card(best.cardId).effects.some((e) => e.type === 'repair')) {
    const l = best.lane;
    best.target = s.walls[l].maxHp - s.walls[l].hp > s.gates[l].maxHp - s.gates[l].hp ? 'wall' : 'gate';
  }
  if (!best || (canUseFallback(s, actor) && bestV < 1)) {
    if (canUseFallback(s, actor)) best = { cardId: RULES.fallbackCard.defender, lane: threat[0], fallback: true };
  }
  if (!best && s.hands[actor].length) best = { cardId: s.hands[actor][0], lane: threat[0] };
  const ability: AbilityPlan = {};
  const open = LANES.filter((l) => !s.breached[l]);
  if (actor === 'lord') ability.lordRally = threat[0];
  if (actor === 'architect') {
    const l = [...open].sort((a, b) => damageOf(s, b) - damageOf(s, a))[0];
    if (l && damageOf(s, l) > 0) ability.architectRepair = { lane: l, structure: s.walls[l].maxHp - s.walls[l].hp > s.gates[l].maxHp - s.gates[l].hp ? 'wall' : 'gate' };
  }
  if (actor === 'quartermaster') ability.quartermasterResupply = threat[0];
  if (actor === 'knight' && knightAvailable(s)) ability.knightMove = threat[0];
  // Lord also handles team moves: reinforce a breached bailey or the most threatened lane from a quiet neighbour.
  const moves: { troopUids: number[]; from: Lane; to: Lane }[] = [];
  if (actor === 'lord') {
    const hot = threat[0];
    const neighbours = LANES.filter((l) => l !== hot && (s.breached[hot] || laneThreat(s, hot) - laneThreat(s, l) > 3));
    for (const n of neighbours) {
      if (!['N', 'E', 'S', 'W'].includes(n)) continue;
      const adjOk = (hot === 'N' || hot === 'S') ? (n === 'E' || n === 'W') : (n === 'N' || n === 'S');
      if (!adjOk || s.breached[n]) continue;
      const here = defendersIn(s, n);
      if (here.length >= 2) moves.push({ from: n, to: hot, troopUids: here.slice(0, Math.floor(here.length / 2)).map((t) => t.uid) });
    }
  }
  void CHARACTERS; void cornersCovering; void mainCampLane; void troopDef;
  return { type: 'planSiege', actor, cards: best ? [best] : [], moves, ability };
}
