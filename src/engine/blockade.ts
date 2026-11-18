// Siege (blockade) phase — GDD v0.2 §9. Between the War Horns and the Assault:
// food dwindles, emplaced Catapults/Trebuchets bombard, the relief army clock ticks,
// and the Warlord can deceive the defenders with stratagem cards.
import { CHARACTER_DEFS, MAP, RULES, building, card, laneName, troopDef } from './data';
import { assertActor, collect, consumeAction } from './build';
import { checkBreaches, feedGarrison, fireRangedEngines, startSiege } from './siege';
import type { Action, GameState, Lane } from './types';
import { CHARACTERS, LANES } from './types';
import {
  addTroop, adjacent, apparentWarlordCount, cap, cornersCovering, fail, fmtRes, log, pay, troopsAt, uid,
} from './util';

const zeroOffsets = (): Record<Lane, number> => ({ N: 0, E: 0, S: 0, W: 0 });

/** War Horns: the castle is surrounded, the relief clock starts, the Siege (blockade) phase begins. */
export function startBlockade(s: GameState) {
  s.hornsSounded = true;
  s.stats.hornsRound = s.round;
  s.relief = { roundsLeft: RULES.relief.rounds };
  s.blockade = { round: 0, offsets: zeroOffsets(), scouted: [] };
  s.phase = 'blockade';
  log(s, `📯 WAR HORNS! The Warlord surrounds the castle after round ${s.round}. The fields are cut off — no more Food will come in.`, 'all', 'horns');
  log(s, `A rider slips out to summon a relief army: it will arrive in ${RULES.relief.rounds} rounds. The Warlord must storm the walls before then.`, 'all', 'horns');
  startBlockadeRound(s);
}

export function startBlockadeRound(s: GameState) {
  const b = s.blockade!;
  b.round += 1;
  b.scouted = [];
  log(s, `══ Siege round ${b.round} · relief army ${s.relief!.roundsLeft} round(s) away ══`, 'all', 'round');
  collect(s);
  feedGarrison(s);
  if (s.engines.some((e) => card(e.cardId).effects.some((x) => x.type === 'engine' && x.ranged))) {
    log(s, '— Bombardment —', 'all', 'step');
    fireRangedEngines(s);
    checkBreaches(s);
  }
  s.turn = { done: [], current: null, actionsLeft: 0, warlordActionsLeft: 0, abilityUsed: {}, returnStep: null };
  s.step = 'chooseCharacter';
}

/** End of a Siege round: the clock ticks; the Warlord decides whether to storm (or is forced to). */
export function endBlockadeRound(s: GameState) {
  s.relief!.roundsLeft -= 1;
  if (s.relief!.roundsLeft <= RULES.relief.forceAssaultAt) {
    s.stats.assaultForced = true;
    log(s, `The relief army is only ${s.relief!.roundsLeft} rounds away — the Warlord must attack now!`);
    return startSiege(s);
  }
  s.step = 'assaultDecision';
}

export function doAssaultDecision(s: GameState, assault: boolean) {
  if (s.step !== 'assaultDecision') fail('Not deciding on the Assault now');
  if (assault) {
    log(s, '⚔ The Warlord orders the Assault!', 'all', 'horns');
    startSiege(s);
  } else {
    log(s, 'The Warlord tightens the blockade and waits.');
    startBlockadeRound(s);
  }
}

export function debugSkipToAssault(s: GameState) {
  if (s.phase === 'build') {
    log(s, '[debug] Jumping to the Assault.');
    startBlockade(s);
  }
  if (s.phase !== 'blockade') fail('Only before the Assault');
  startSiege(s);
}

// ---------------- Defender actions ----------------

export function repairCost(actor: string): { cost: Record<string, number>; amount: number } {
  const bonus = actor === 'architect' ? RULES.repair.architectBonus : 0;
  return { cost: { ...RULES.repair.cost }, amount: RULES.repair.amount + bonus };
}

/** Repair a wall, gate or tower (any phase with turns). Rubble can't be repaired. */
export function doRepair(s: GameState, a: Extract<Action, { type: 'repair' }>) {
  assertActor(s, a.actor);
  const { cost, amount } = repairCost(a.actor);
  if (a.structure === 'tower') {
    const corner = a.corner ?? cornersCovering(a.lane).find((c) => s.towers[c] && s.towers[c]!.hp < s.towers[c]!.maxHp);
    const t = corner ? s.towers[corner] : null;
    if (!corner || !t) fail('No damaged tower there');
    if (t.hp >= t.maxHp) fail('That tower is not damaged');
    pay(s.stock.defender, cost, 'repairs');
    const before = t.hp;
    t.hp = Math.min(t.maxHp, t.hp + amount);
    log(s, `${CHARACTER_DEFS[a.actor].name} repairs the ${corner} ${building(t.buildingId).name} +${t.hp - before} → ${t.hp}/${t.maxHp} (${fmtRes(cost)}).`);
  } else {
    const st = a.structure === 'wall' ? s.walls[a.lane] : s.gates[a.lane];
    if (st.hp <= 0) fail('That is rubble and cannot be repaired');
    if (st.hp >= st.maxHp) fail(`The ${laneName(a.lane)} ${a.structure} is not damaged`);
    pay(s.stock.defender, cost, 'repairs');
    const before = st.hp;
    st.hp = Math.min(st.maxHp, st.hp + amount);
    log(s, `${CHARACTER_DEFS[a.actor].name} repairs the ${laneName(a.lane)} ${a.structure} +${st.hp - before} → ${st.hp}/${st.maxHp} (${fmtRes(cost)}).`);
  }
  consumeAction(s, a.actor);
}

/** Scout one approach: the defenders learn its true troop count (clears any deception there). */
export function doScout(s: GameState, a: Extract<Action, { type: 'scout' }>) {
  assertActor(s, a.actor);
  if (s.phase !== 'blockade') fail('Scouting is a Siege-phase action');
  const b = s.blockade!;
  const actual = troopsAt(s, 'warlord', a.lane, 'approach');
  const believed = apparentWarlordCount(s, a.lane);
  b.offsets[a.lane] = 0;
  if (!b.scouted.includes(a.lane)) b.scouted.push(a.lane);
  const types: Record<string, number> = {};
  for (const t of actual) types[troopDef(t.type).name] = (types[troopDef(t.type).name] ?? 0) + 1;
  const detail = Object.entries(types).map(([k, v]) => `${v} ${k}`).join(', ') || 'no troops';
  log(s, `${CHARACTER_DEFS[a.actor].name} sends scouts into the ${laneName(a.lane)} approach.`);
  log(s, `🔍 Scouts report ${actual.length} troops in the ${laneName(a.lane)} approach (${detail})${believed !== actual.length ? ` — not the ${believed} we thought!` : '.'}`, 'defender');
  s.intel.push({ side: 'defender', text: `${laneName(a.lane)} approach: ${actual.length} troops (${detail})`, round: b.round });
  consumeAction(s, a.actor);
}

/** Levy: turn townsfolk into Militia beyond the garrison cap. */
export function doLevy(s: GameState, a: Extract<Action, { type: 'levy' }>) {
  assertActor(s, a.actor);
  if (s.phase !== 'blockade') fail('Levies are raised during the Siege phase');
  if ((s.population ?? 0) <= 0) fail('The town has no more able-bodied folk');
  const n = Math.min(RULES.levy.count, s.population);
  s.population -= n;
  for (let i = 0; i < n; i++) addTroop(s, 'defender', 'militia', a.lane, 'bailey');
  log(s, `${CHARACTER_DEFS[a.actor].name} levies ${n} townsfolk as Militia in the ${laneName(a.lane)} bailey (${s.population} townsfolk left; more mouths to feed).`);
  consumeAction(s, a.actor);
}

// ---------------- Warlord actions ----------------

function takeFromDeck(s: GameState, cardId: string) {
  const i = s.siegeDecks.warlord.indexOf(cardId);
  if (i < 0) fail(`${card(cardId).name} is not in the Warlord's siege deck`);
  s.siegeDecks.warlord.splice(i, 1);
}

/** Emplace an engine from the siege deck onto an approach, face up. */
export function doEmplace(s: GameState, a: Extract<Action, { type: 'emplace' }>) {
  assertActor(s, 'warlord');
  if (s.phase !== 'blockade') fail('Engines are emplaced during the Siege phase');
  const c = card(a.cardId);
  const eng = c.effects.find((e) => e.type === 'engine');
  if (!eng) fail(`${c.name} is not a siege engine`);
  if (!LANES.includes(a.lane)) fail('Choose an approach');
  let target = (a.target ?? eng.target) as 'gate' | 'wall' | 'tower';
  if (target === 'tower' && !eng.canHitTowers) fail(`${c.name} can't target towers`);
  if (eng.canHitTowers && target === 'gate') target = eng.target;
  takeFromDeck(s, a.cardId);
  s.engines.push({ uid: uid(s), cardId: c.id, lane: a.lane, hp: eng.hp, target });
  log(s, `The Warlord emplaces a ${c.name} in the ${laneName(a.lane)} approach${eng.ranged ? ` (aimed at the ${target === 'tower' ? 'towers' : target})` : ''}.`);
  consumeAction(s, 'warlord');
}

/** Play a stratagem card (Night March / Campfires) from the siege deck. Hidden from the defenders. */
export function doStratagem(s: GameState, a: Extract<Action, { type: 'stratagem' }>) {
  assertActor(s, 'warlord');
  if (s.phase !== 'blockade') fail('Stratagems are played during the Siege phase');
  const c = card(a.cardId);
  const fx = c.effects.find((e) => e.type === 'stratagem');
  if (!fx) fail(`${c.name} is not a stratagem`);
  const b = s.blockade!;
  if (fx.kind === 'nightMarch') {
    if (!a.to || !adjacent(a.lane, a.to)) fail('Night March moves troops to an adjacent approach');
    const here = troopsAt(s, 'warlord', a.lane, 'approach');
    const n = Math.min(a.count ?? RULES.stratagems.nightMarchMax, RULES.stratagems.nightMarchMax, here.length);
    if (n <= 0) fail('No troops to move');
    takeFromDeck(s, a.cardId);
    // Move the strongest troops.
    const moving = [...here].sort((x, y) => troopDef(y.type).strength - troopDef(x.type).strength).slice(0, n);
    for (const t of moving) t.lane = a.to;
    b.offsets[a.lane] += n;
    b.offsets[a.to] -= n;
    log(s, `🌙 Night March: ${n} troops slip from the ${laneName(a.lane)} to the ${laneName(a.to)} approach. The campfires keep burning where they were.`, 'warlord');
  } else if (fx.kind === 'campfires') {
    takeFromDeck(s, a.cardId);
    const k = RULES.stratagems.campfiresPhantom;
    b.offsets[a.lane] += k;
    log(s, `🔥 Campfires: the ${laneName(a.lane)} approach now looks like it holds ${k} more troops.`, 'warlord');
  } else fail('Unknown stratagem');
  s.stats.stratagems++;
  log(s, 'Something stirs in the Warlord\'s camp tonight…', 'defender');
  consumeAction(s, 'warlord');
}

export const BLOCKADE_INFO = { CHARACTERS, MAP, cap };
