import { BUILDINGS, MAP, RULES, building, troopDef } from './data';
import type {
  Actor, Corner, GameState, Lane, PlacedBuilding, Resources, Side, Troop,
} from './types';
import { CORNERS, LANES } from './types';

export class GameError extends Error {}

export function fail(msg: string): never {
  throw new GameError(msg);
}

export function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

export function log(s: GameState, text: string, vis: 'all' | Side = 'all', tag?: string) {
  s.log.push(tag ? { text, vis, tag } : { text, vis });
}

export function sideOf(a: Actor): Side {
  return a === 'warlord' ? 'warlord' : 'defender';
}

export function uid(s: GameState): number {
  return s.nextUid++;
}

// ---------- Resources ----------

export function canAfford(stock: Resources, cost: Resources): boolean {
  return Object.entries(cost).every(([k, v]) => (stock[k] ?? 0) >= v);
}

export function pay(stock: Resources, cost: Resources, what = 'that') {
  if (!canAfford(stock, cost)) fail(`Not enough resources for ${what} (needs ${fmtRes(cost)})`);
  for (const [k, v] of Object.entries(cost)) stock[k] = (stock[k] ?? 0) - v;
}

export function addRes(stock: Resources, gain: Resources, mult = 1) {
  for (const [k, v] of Object.entries(gain)) stock[k] = (stock[k] ?? 0) + Math.floor(v * mult);
}

export function fmtRes(r: Resources): string {
  const parts = Object.entries(r).filter(([, v]) => v).map(([k, v]) => `${v} ${cap(k)}`);
  return parts.length ? parts.join(', ') : 'nothing';
}

export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Apply a discount; a discount never makes a non-free cost free (rules.minimumCostAfterDiscount). */
export function discount(cost: Resources, res: string, amount: number): Resources {
  const c = { ...cost };
  if (!c[res]) return c;
  const total = Object.values(cost).reduce((a, b) => a + b, 0);
  const floor = RULES.minimumCostAfterDiscount ?? 0;
  const others = total - c[res];
  c[res] = Math.max(0, c[res] - amount, floor - others);
  return c;
}

// ---------- Map helpers ----------

export function cornersCovering(lane: Lane): Corner[] {
  return CORNERS.filter((c) => MAP.towers[c].covers.includes(lane));
}

export function adjacent(a: Lane, b: Lane): boolean {
  return MAP.adjacency[a].includes(b);
}

// ---------- Buildings ----------

export interface LocatedBuilding {
  b: PlacedBuilding;
  zone: 'bailey' | 'approach' | 'tower';
  lane?: Lane;
  corner?: Corner;
}

export function buildingsOf(s: GameState, side: Side): LocatedBuilding[] {
  const out: LocatedBuilding[] = [];
  if (side === 'defender') {
    for (const l of LANES) for (const b of s.baileys[l]) if (b) out.push({ b, zone: 'bailey', lane: l });
    for (const c of CORNERS) { const t = s.towers[c]; if (t) out.push({ b: t, zone: 'tower', corner: c }); }
  } else {
    for (const l of LANES) for (const b of s.approaches[l]) if (b) out.push({ b, zone: 'approach', lane: l });
  }
  return out;
}

/** Upgraded buildings count as the building they upgraded (Garrison Hall is a Barracks, etc.). */
export function satisfies(buildingId: string, required: string): boolean {
  let cur: string | undefined = buildingId;
  while (cur) {
    if (cur === required) return true;
    cur = BUILDINGS[cur]?.upgradeOf;
  }
  return false;
}

export function hasBuilding(s: GameState, side: Side, id: string): boolean {
  return buildingsOf(s, side).some((x) => satisfies(x.b.buildingId, id));
}

export function countBuilding(s: GameState, side: Side, id: string): number {
  return buildingsOf(s, side).filter((x) => x.b.buildingId === id).length;
}

export function mainCampLane(s: GameState): Lane | null {
  for (const l of LANES) if (s.approaches[l].some((b) => b?.buildingId === 'main_siege_camp')) return l;
  return null;
}

export function laneBuildingAttack(s: GameState, lane: Lane): number {
  return s.approaches[lane].reduce((t, b) => t + (b ? building(b.buildingId).laneAttack ?? 0 : 0), 0);
}

// ---------- Supply ----------

export function supplyRating(s: GameState): number {
  let r = RULES.baseSupplyRating;
  for (const x of buildingsOf(s, 'warlord')) r += building(x.b.buildingId).supplyRating ?? 0;
  return r;
}

export function warlordTroopCount(s: GameState): number {
  return s.troops.filter((t) => t.side === 'warlord').length;
}

export function overSupplied(s: GameState): boolean {
  return warlordTroopCount(s) > supplyRating(s);
}

// ---------- Garrison (defender troop cap) ----------

/** Defender troops the castle can house. The Knight doesn't count. */
export function garrisonCapacity(s: GameState): number {
  let cap = RULES.garrison.baseCapacity;
  for (const x of buildingsOf(s, 'defender')) cap += building(x.b.buildingId).garrisonCapacity ?? 0;
  return cap;
}

export function defenderTroopCount(s: GameState): number {
  return s.troops.filter((t) => t.side === 'defender').length;
}

export function garrisonRoom(s: GameState): number {
  return Math.max(0, garrisonCapacity(s) - defenderTroopCount(s));
}

// ---------- Food ----------

/** Food the garrison eats each siege round: 1 per `troopsPerFood` troops (rounded up). */
export function foodUpkeep(s: GameState): number {
  return Math.ceil(s.troops.filter((t) => t.side === 'defender').length / RULES.food.troopsPerFood);
}

// ---------- What the defenders can see ----------

/**
 * Warlord troops the defenders believe are in an approach. During the Siege (blockade),
 * Night March and Campfires make this differ from the truth; otherwise it is the real count.
 */
export function apparentWarlordCount(s: GameState, lane: Lane): number {
  const actual = troopsAt(s, 'warlord', lane, 'approach').length;
  if (s.phase !== 'blockade' || !s.blockade) return actual;
  return Math.max(0, actual + (s.blockade.offsets[lane] ?? 0));
}

// ---------- Troops ----------

export function troopsAt(s: GameState, side: Side, lane: Lane, zone: 'bailey' | 'approach'): Troop[] {
  return s.troops.filter((t) => t.side === side && t.lane === lane && t.zone === zone);
}

export function defendersIn(s: GameState, lane: Lane): Troop[] {
  return troopsAt(s, 'defender', lane, 'bailey');
}

export function knightIn(s: GameState, lane: Lane): boolean {
  return s.knight.lane === lane && s.knight.hp > 0;
}

export function troopStrength(s: GameState, t: Troop): number {
  let str = troopDef(t.type).strength;
  if (t.side === 'defender') {
    if (hasBuilding(s, 'defender', 'garrison_hall')) str += building('garrison_hall').troopStrengthBonus ?? 1;
    for (const x of buildingsOf(s, 'defender')) if (x.b.buildingId === 'weaponsmith' && x.b.troopType === t.type) str += 1;
    if (s.hungry) str -= RULES.food.hungerStrengthPenalty;
  } else {
    if (overSupplied(s)) str -= RULES.overSupplyStrengthPenalty;
    const cal = s.siege?.mods.caltrops[t.lane] ?? 0;
    str -= cal;
  }
  return Math.max(0, str);
}

export function sumStrength(s: GameState, troops: Troop[]): number {
  return troops.reduce((a, t) => a + troopStrength(s, t), 0);
}

/** Total defender strength standing in a bailey, including the Knight. */
export function baileyStrength(s: GameState, lane: Lane): number {
  return sumStrength(s, defendersIn(s, lane)) + (knightIn(s, lane) ? RULES.knight.strength : 0);
}

export function weakest(s: GameState, troops: Troop[]): Troop | undefined {
  return [...troops].sort((a, b) => troopStrength(s, a) - troopStrength(s, b) || a.hp - b.hp || a.uid - b.uid)[0];
}

export function removeTroop(s: GameState, t: Troop) {
  s.troops = s.troops.filter((x) => x.uid !== t.uid);
}

export function addTroop(s: GameState, side: Side, type: string, lane: Lane, zone: 'bailey' | 'approach'): Troop {
  const t: Troop = { uid: uid(s), type, side, lane, zone, hp: troopDef(type).hp };
  s.troops.push(t);
  return t;
}

export function towerDefense(s: GameState, lane: Lane): number {
  let d = 0;
  for (const c of cornersCovering(lane)) {
    const t = s.towers[c];
    if (t) d += building(t.buildingId).tower?.defense ?? 0;
  }
  return d;
}

export function totalDefenderStrength(s: GameState): number {
  return sumStrength(s, s.troops.filter((t) => t.side === 'defender')) + (s.knight.hp > 0 ? RULES.knight.strength : 0);
}

export function totalWarlordStrength(s: GameState): number {
  return sumStrength(s, s.troops.filter((t) => t.side === 'warlord'));
}

// ---------- Income ----------

export function incomeFor(s: GameState, side: Side, ignoreHarass = false): Resources {
  const inc: Resources = { ...(RULES.baseIncome as any)[side] };
  for (const x of buildingsOf(s, side)) {
    if (!ignoreHarass && s.harassed.includes(x.b.uid)) continue;
    const def = building(x.b.buildingId);
    if (def.produces) addRes(inc, def.produces);
    if (side === 'defender' && def.id === 'market') inc.gold = (inc.gold ?? 0) + 1; // Quartermaster passive
  }
  if (side === 'defender' && (s.phase === 'siege' || s.phase === 'blockade') && !RULES.food.incomeDuringSiege) delete inc.food;
  if (side === 'warlord' && isWarlordAI(s)) {
    const m = (RULES.ai.difficultyIncome as any)[s.config.difficulty] ?? 1;
    for (const k of Object.keys(inc)) inc[k] = Math.round(inc[k] * m);
  }
  return inc;
}

export function isWarlordAI(s: GameState): boolean {
  return s.config.players.some((p) => p.ai && p.controls.includes('warlord'));
}

export function isAI(s: GameState, a: Actor): boolean {
  return s.config.players.some((p) => p.ai && p.controls.includes(a));
}

export function controllerOf(s: GameState, a: Actor) {
  return s.config.players.find((p) => p.controls.includes(a));
}

export function structureLabel(kind: 'wall' | 'gate', lane: Lane): string {
  return `${MAP.laneNames[lane]} ${kind}`;
}
