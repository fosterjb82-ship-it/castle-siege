import { CHARACTER_DEFS, RULES, building, card, laneName, troopDef } from './data';
import { randInt, shuffle } from './rng';
import type {
  Action, Actor, CardDef, GameState, Lane, RoundMods, SiegePlay, Structure, StructureKind, Troop,
} from './types';
import { CHARACTERS, LANES, RESOLVE_STEPS } from './types';
import {
  addTroop, adjacent, baileyStrength, buildingsOf, cornersCovering, defendersIn, fail, hasBuilding, knightIn,
  laneBuildingAttack, log, removeTroop, sideOf, sumStrength, towerDefense, troopStrength, troopsAt, uid, weakest,
  incomeFor, addRes, fmtRes,
} from './util';

const NAME = (a: Actor) => (a === 'warlord' ? 'Warlord' : CHARACTER_DEFS[a].name);
const ACTORS: Actor[] = [...CHARACTERS, 'warlord'];

function emptyMods(): RoundMods {
  return { attack: {}, defense: {}, caltrops: {}, gateDebuff: {}, bridge: {}, assaultTarget: {}, underAttack: {} };
}

export function handSize(s: GameState, a: Actor): number {
  if (a !== 'warlord') return RULES.handSize.defenderPerCharacter;
  let n = RULES.handSize.warlord;
  for (const x of buildingsOf(s, 'warlord')) n += building(x.b.buildingId).handSizeBonus ?? 0;
  return n;
}

function drawTo(s: GameState, a: Actor, n: number) {
  while (s.hands[a].length < n && s.siegeDecks[a].length) s.hands[a].push(s.siegeDecks[a].shift()!);
}

export function startSiege(s: GameState) {
  s.phase = 'siege';
  s.step = 'siege';
  s.siegeRound = 0;
  log(s, '══════ THE SIEGE BEGINS ══════', 'all', 'round');
  for (const a of ACTORS) {
    shuffle(s, s.siegeDecks[a]);
    drawTo(s, a, handSize(s, a));
  }
  s.siege = {
    stage: 'plan', planned: [], plays: [], moves: [], abilities: {}, nextStep: 0,
    rallyActive: {}, rallyNext: {}, mods: emptyMods(),
  };
  beginSiegeRound(s);
}

function beginSiegeRound(s: GameState) {
  const sg = s.siege!;
  s.siegeRound += 1;
  log(s, `══ Siege round ${s.siegeRound} of ${RULES.siegeRounds} ══`, 'all', 'round');
  for (const side of ['defender', 'warlord'] as const) {
    const inc = incomeFor(s, side);
    addRes(s.stock[side], inc);
  }
  if (s.knight.downUntilSiegeRound !== null && s.siegeRound >= s.knight.downUntilSiegeRound) {
    s.knight = { lane: null, hp: RULES.knight.hp, downUntilSiegeRound: null };
    log(s, 'The Knight has recovered and returns to the Keep.');
  }
  sg.stage = 'plan';
  sg.planned = [];
  sg.plays = [];
  sg.moves = [];
  sg.abilities = {};
  sg.nextStep = 0;
  sg.rallyActive = sg.rallyNext;
  sg.rallyNext = {};
  sg.mods = emptyMods();
}

export function knightAvailable(s: GameState): boolean {
  return s.knight.hp > 0 && s.knight.downUntilSiegeRound === null;
}

export function cardsRequired(a: Actor): number {
  return a === 'warlord' ? RULES.warlordCardsPerRound : 1;
}

export function fallbackCard(a: Actor): string {
  return a === 'warlord' ? RULES.fallbackCard.warlord : RULES.fallbackCard.defender;
}

/** Fallback (basic) cards are allowed once the draw pile is empty. */
export function canUseFallback(s: GameState, a: Actor): boolean {
  return s.siegeDecks[a].length === 0;
}

export function cardPlayError(s: GameState, a: Actor, c: CardDef, lane: Lane): string | null {
  if (c.side !== sideOf(a)) return `${c.name} is not your card`;
  if (c.laneRule !== 'any' && c.laneRule !== 'none' && c.laneRule !== lane) return `${c.name} can only be played in the ${laneName(c.laneRule)} lane`;
  if (c.character && c.character !== a) return `${c.name} can only be played by the ${CHARACTER_DEFS[c.character].name}`;
  if (c.requires && !hasBuilding(s, sideOf(a), c.requires)) return `${c.name} requires a ${building(c.requires).name}`;
  return null;
}

export function doPlanSiege(s: GameState, a: Extract<Action, { type: 'planSiege' }>) {
  const sg = s.siege;
  if (s.phase !== 'siege' || !sg || sg.stage !== 'plan') fail('Not planning a siege round');
  if (sg.planned.includes(a.actor)) fail(`${NAME(a.actor)} has already planned`);
  const need = cardsRequired(a.actor);
  if (a.cards.length !== need) fail(`${NAME(a.actor)} must play exactly ${need} card(s)`);

  // Cards
  const hand = [...s.hands[a.actor]];
  const plays: SiegePlay[] = [];
  for (const cp of a.cards) {
    if (!LANES.includes(cp.lane)) fail('Choose a lane for each card');
    let fb = false;
    const idx = hand.indexOf(cp.cardId);
    if (idx >= 0 && !cp.fallback) hand.splice(idx, 1);
    else if (cp.cardId === fallbackCard(a.actor) && (canUseFallback(s, a.actor) || cp.fallback)) {
      if (!canUseFallback(s, a.actor)) fail('Basic fallback cards are only available once your siege deck is empty');
      fb = true;
    } else fail(`${card(cp.cardId).name} is not in ${NAME(a.actor)}'s hand`);
    const c = card(cp.cardId);
    const err = cardPlayError(s, a.actor, c, cp.lane);
    if (err) fail(err);
    const play: SiegePlay = { actor: a.actor, cardId: c.id, lane: cp.lane };
    if (fb) play.fallback = true;
    const engFx = c.effects.find((e) => e.type === 'engine');
    if (c.target === 'any') play.target = cp.target ?? 'gate';
    if (engFx?.canHitTowers) play.target = cp.target ?? engFx.target;
    if (c.target === 'any' && play.target === 'tower') fail('That card cannot target a tower');
    if (engFx?.canHitTowers && play.target === 'gate') fail(`${c.name} targets a wall or a tower`);
    if (c.effects.some((e) => e.type === 'peekHand' && e.target === 'defender'))
      play.spyTarget = cp.spyTarget ?? 'lord';
    plays.push(play);
  }

  // Moves
  const moved = new Set<number>(sg.moves.flatMap((m) => m.troopUids));
  for (const m of a.moves ?? []) {
    if (!m.troopUids.length) continue;
    if (a.actor === 'warlord') {
      if (m.from !== m.to) fail('Warlord troops may only move from an approach into its own breached bailey');
      if (!s.breached[m.from]) fail(`The ${laneName(m.from)} lane is not breached`);
      const here = troopsAt(s, 'warlord', m.from, 'approach').map((t) => t.uid);
      if (!m.troopUids.every((u) => here.includes(u))) fail('Those troops are not in that approach');
    } else {
      if (!adjacent(m.from, m.to)) fail('Defenders move only between adjacent baileys');
      const here = defendersIn(s, m.from).map((t) => t.uid);
      if (!m.troopUids.every((u) => here.includes(u))) fail('Those troops are not in that bailey');
    }
    for (const u of m.troopUids) {
      if (moved.has(u)) fail('A troop can only move once per round');
      moved.add(u);
    }
    sg.moves.push({ side: sideOf(a.actor), troopUids: [...m.troopUids], from: m.from, to: m.to });
  }

  // Character ability
  const ab = a.ability ?? {};
  if (a.actor === 'lord' && ab.lordRally) sg.abilities.lordRally = ab.lordRally;
  if (a.actor === 'architect' && ab.architectRepair) sg.abilities.architectRepair = ab.architectRepair;
  if (a.actor === 'quartermaster' && ab.quartermasterResupply) sg.abilities.quartermasterResupply = ab.quartermasterResupply;
  if (a.actor === 'knight' && ab.knightMove) {
    if (!knightAvailable(s)) fail('The Knight is recovering this round');
    sg.abilities.knightMove = ab.knightMove;
  }

  s.hands[a.actor] = hand;
  sg.plays.push(...plays);
  sg.planned.push(a.actor);
  const side = sideOf(a.actor);
  log(s, `${NAME(a.actor)} places ${plays.length} card(s) face down.`);
  log(s, `${NAME(a.actor)} plans: ${plays.map((p) => `${card(p.cardId).name} → ${laneName(p.lane)}`).join('; ')}.`, side);

  if (ACTORS.every((x) => sg.planned.includes(x))) {
    sg.stage = 'resolve';
    sg.nextStep = 0;
    log(s, 'All plans are in. Reveal!');
  }
}

export function doAdvanceSiege(s: GameState) {
  const sg = s.siege;
  if (s.phase !== 'siege' || !sg || sg.stage !== 'resolve') fail('Nothing to resolve');
  const step = RESOLVE_STEPS[sg.nextStep];
  STEP_FNS[step](s);
  checkBreaches(s);
  checkVictory(s, false);
  if (s.winner) return;
  sg.nextStep += 1;
  if (sg.nextStep >= RESOLVE_STEPS.length) endSiegeRound(s);
}

const STEP_FNS: Record<(typeof RESOLVE_STEPS)[number], (s: GameState) => void> = {
  reveal: stepReveal,
  scout: stepScout,
  ranged: stepRanged,
  engine: stepEngines,
  melee: stepMelee,
  recovery: stepRecovery,
};

function playsAt(s: GameState, speed: string): SiegePlay[] {
  return s.siege!.plays.filter((p) => !p.fizzled && card(p.cardId).speed === speed);
}

function count(s: GameState, p: SiegePlay) {
  s.stats.cardsPlayed[p.cardId] = (s.stats.cardsPlayed[p.cardId] ?? 0) + 1;
}

// ---------- Step 0: reveal and moves ----------

function stepReveal(s: GameState) {
  const sg = s.siege!;
  log(s, '— Reveal —', 'all', 'step');
  for (const p of sg.plays) {
    count(s, p);
    const extra = p.target && card(p.cardId).target !== 'none' ? ` (target: ${p.target})` : '';
    log(s, `${NAME(p.actor)}: ${card(p.cardId).name} → ${laneName(p.lane)}${extra}${p.fallback ? ' [basic]' : ''}`);
  }
  for (const m of sg.moves) {
    const ts = s.troops.filter((t) => m.troopUids.includes(t.uid));
    for (const t of ts) {
      if (m.side === 'defender') t.lane = m.to;
      else t.zone = 'bailey';
    }
    if (ts.length) {
      log(s, m.side === 'defender'
        ? `Defenders move ${ts.length} troop(s) from the ${laneName(m.from)} to the ${laneName(m.to)} bailey.`
        : `⚠ ${ts.length} Warlord troop(s) pour into the breached ${laneName(m.from)} bailey!`);
    }
  }
  if (sg.abilities.knightMove && knightAvailable(s)) {
    s.knight.lane = sg.abilities.knightMove;
    log(s, `The Knight rides to the ${laneName(s.knight.lane)} bailey.`);
  }
  // Engines take the field when revealed.
  for (const p of sg.plays) {
    const eng = card(p.cardId).effects.find((e) => e.type === 'engine');
    if (eng) {
      s.engines.push({ uid: uid(s), cardId: p.cardId, lane: p.lane, hp: eng.hp, target: (p.target as any) ?? eng.target });
      const tgt = (p.target as string | undefined) ?? eng.target;
      log(s, `A ${card(p.cardId).name} rolls up to the ${laneName(p.lane)} ${tgt === 'tower' ? 'towers' : tgt}.`);
    }
    if (sideOf(p.actor) === 'warlord') sg.mods.underAttack[p.lane] = true;
    // Round-long modifiers that are not tied to a step.
    for (const e of card(p.cardId).effects) {
      if (e.type === 'debuffStructure' && e.structure === 'gate')
        sg.mods.gateDebuff[p.lane] = (sg.mods.gateDebuff[p.lane] ?? 0) + e.amount;
    }
  }
}

// ---------- Step 1: scouting and tricks ----------

function peekText(cardId: string): string {
  const c = card(cardId);
  const decoy = c.effects.find((e) => e.type === 'decoy');
  return decoy ? card(decoy.looksLike).name : c.name;
}

export function laneUnderAttack(s: GameState, lane: Lane): boolean {
  const sg = s.siege;
  if (!sg) return false;
  return !!sg.mods.underAttack[lane]
    || s.engines.some((e) => e.lane === lane)
    || troopsAt(s, 'warlord', lane, 'bailey').length > 0;
}

function stepScout(s: GameState) {
  const sg = s.siege!;
  log(s, '— Scouting & tricks —', 'all', 'step');
  for (const p of playsAt(s, 'scout')) {
    const c = card(p.cardId);
    for (const e of c.effects) {
      switch (e.type) {
        case 'peekHand': {
          const target: Actor = e.target === 'warlord' ? 'warlord' : (p.spyTarget ?? 'lord');
          const h = s.hands[target];
          const viewer = sideOf(p.actor);
          if (!h.length) { log(s, `${c.name}: ${NAME(target)}'s hand is empty.`, viewer); break; }
          const seen = peekText(h[randInt(s, h.length)]);
          const text = `${c.name}: ${NAME(target)} holds ${seen}.`;
          s.intel.push({ side: viewer, text, round: s.siegeRound });
          log(s, `${NAME(p.actor)} scouts ${NAME(target)}'s hand.`);
          log(s, `🔍 ${text}`, viewer);
          break;
        }
        case 'drawCards': {
          const ok = e.condition !== 'noEnemyCardInLane'
            || !sg.plays.some((q) => q.lane === p.lane && sideOf(q.actor) !== sideOf(p.actor));
          if (ok) {
            const before = s.hands[p.actor].length;
            for (let i = 0; i < e.amount && s.siegeDecks[p.actor].length; i++) s.hands[p.actor].push(s.siegeDecks[p.actor].shift()!);
            log(s, `${c.name}: the ${laneName(p.lane)} lane was quiet — ${NAME(p.actor)} draws ${s.hands[p.actor].length - before}.`);
          } else log(s, `${c.name}: the Warlord did play in the ${laneName(p.lane)} lane — no effect.`);
          break;
        }
        case 'ignoreMoat':
          sg.mods.bridge[p.lane] = true;
          log(s, `Bridge: engines ignore the ${laneName(p.lane)} moat this round.`);
          break;
        case 'decoy':
          log(s, `Decoy Banners in the ${laneName(p.lane)} lane — nothing but flags.`);
          break;
      }
    }
  }
}

// ---------- Damage helpers ----------

type Target = { kind: 'troop'; t: Troop } | { kind: 'knight' };

function defenderTargets(s: GameState, lane: Lane): Target[] {
  const out: Target[] = defendersIn(s, lane).map((t) => ({ kind: 'troop', t }) as Target);
  if (knightIn(s, lane)) out.push({ kind: 'knight' });
  return out;
}

/** How many approach troops the lane's Siege Towers can shelter from ranged fire. */
export function shelterCapacity(s: GameState, lane: Lane): number {
  return s.engines.filter((e) => e.lane === lane)
    .reduce((a, e) => a + (card(e.cardId).effects.find((x) => x.type === 'engine')?.shelter ?? 0), 0);
}

/** Approach troops riding inside Siege Towers: the strongest ones, up to capacity. */
export function shelteredTroops(s: GameState, lane: Lane): Set<number> {
  const cap = shelterCapacity(s, lane);
  if (!cap) return new Set();
  const inApproach = troopsAt(s, 'warlord', lane, 'approach')
    .sort((a, b) => troopStrength(s, b) - troopStrength(s, a) || a.uid - b.uid);
  return new Set(inApproach.slice(0, cap).map((t) => t.uid));
}

/**
 * Only attacking troops can be targeted: troops inside a bailey, or in the approach of a lane under attack.
 * With `asTargets`, troops sheltered by a Siege Tower are left out (they can't be shot, but can still shoot).
 */
function warlordTargets(s: GameState, lane: Lane, approachOnly = false, asTargets = true): Target[] {
  const attacking = laneUnderAttack(s, lane);
  const sheltered = asTargets ? shelteredTroops(s, lane) : new Set<number>();
  return s.troops
    .filter((t) => t.side === 'warlord' && t.lane === lane && (!approachOnly || t.zone === 'approach')
      && (t.zone === 'bailey' || attacking) && !sheltered.has(t.uid))
    .map((t) => ({ kind: 'troop', t }) as Target);
}

function hpOf(s: GameState, x: Target) { return x.kind === 'knight' ? s.knight.hp : x.t.hp; }
function strOf(s: GameState, x: Target) { return x.kind === 'knight' ? RULES.knight.strength : troopStrength(s, x.t); }

/** Deal `points` single damage points, each to the target most likely to fall (lowest HP, then strongest). */
function dealDamage(s: GameState, getTargets: () => Target[], points: number, source: string) {
  const killed: string[] = [];
  let dealt = 0;
  for (let i = 0; i < points; i++) {
    const ts = getTargets().filter((x) => hpOf(s, x) > 0);
    if (!ts.length) break;
    ts.sort((a, b) => hpOf(s, a) - hpOf(s, b) || strOf(s, b) - strOf(s, a)
      || (a.kind === 'knight' ? 1 : 0) - (b.kind === 'knight' ? 1 : 0));
    const x = ts[0];
    dealt++;
    if (x.kind === 'knight') {
      s.knight.hp -= 1;
      if (s.knight.hp <= 0) { defeatKnight(s); killed.push('the Knight'); }
    } else {
      x.t.hp -= 1;
      if (x.t.hp <= 0) { removeTroop(s, x.t); killed.push(troopDef(x.t.type).name); }
    }
  }
  if (dealt) log(s, `${source}: ${dealt} damage${killed.length ? ` — ${killed.join(', ')} fall${killed.length === 1 ? 's' : ''}` : ''}.`);
}

function defeatKnight(s: GameState) {
  s.knight.hp = 0;
  s.knight.lane = null;
  s.knight.downUntilSiegeRound = s.siegeRound + 1 + RULES.knight.downRounds;
  log(s, '⚠ The Knight is defeated! They will return to the Keep after a round.');
}

function struct(s: GameState, lane: Lane, kind: StructureKind): Structure {
  return kind === 'wall' ? s.walls[lane] : s.gates[lane];
}

function structDefense(s: GameState, lane: Lane, kind: StructureKind): number {
  const st = struct(s, lane, kind);
  const base = building(st.buildingId).structure!.defense;
  const debuff = kind === 'gate' ? s.siege?.mods.gateDebuff[lane] ?? 0 : 0;
  return Math.max(0, base - debuff);
}

function damageStructure(s: GameState, lane: Lane, kind: StructureKind, amount: number, source: string) {
  const st = struct(s, lane, kind);
  if (amount <= 0 || st.hp <= 0) return;
  let left = amount;
  const absorbed = Math.min(st.tempHp, left);
  st.tempHp -= absorbed;
  left -= absorbed;
  st.hp = Math.max(0, st.hp - left);
  log(s, `${source}: ${amount} damage to the ${laneName(lane)} ${kind}${absorbed ? ` (${absorbed} absorbed by barricades)` : ''} → ${st.hp}/${st.maxHp}.`);
}

function checkBreaches(s: GameState) {
  for (const l of LANES) {
    if (!s.breached[l] && (s.walls[l].hp <= 0 || s.gates[l].hp <= 0)) {
      s.breached[l] = true;
      const what = s.gates[l].hp <= 0 ? 'gate' : 'wall';
      log(s, `💥 BREACH! The ${laneName(l)} ${what} has fallen. Warlord troops may enter the ${laneName(l)} bailey next round.`, 'all', 'breach');
      const b = { lane: l, siegeRound: s.siegeRound };
      s.stats.breaches.push(b);
      s.stats.firstBreach ??= b;
    }
  }
}

// ---------- Step 2: ranged ----------

function deploy(s: GameState, p: SiegePlay, speed: string) {
  if (card(p.cardId).speed !== speed) return;
  for (const e of card(p.cardId).effects) {
    if (e.type !== 'deployTroops') continue;
    const side = sideOf(p.actor);
    const throughBreach = side === 'warlord' && s.breached[p.lane] && (RULES as any).breachDeployIntoBailey;
    const zone = side === 'defender' || throughBreach ? 'bailey' : 'approach';
    for (let i = 0; i < e.count; i++) addTroop(s, side, e.troop, p.lane, zone);
    log(s, `${card(p.cardId).name}: ${e.count} ${troopDef(e.troop).name} join the ${laneName(p.lane)} ${zone}.`);
  }
}

function stepRanged(s: GameState) {
  const sg = s.siege!;
  log(s, '— Ranged —', 'all', 'step');
  const plays = playsAt(s, 'ranged');
  for (const p of plays) deploy(s, p, 'ranged');
  for (const p of plays) for (const e of card(p.cardId).effects)
    if (e.type === 'debuffTroops') {
      sg.mods.caltrops[p.lane] = (sg.mods.caltrops[p.lane] ?? 0) + e.amount;
      log(s, `Caltrops: Warlord troops in the ${laneName(p.lane)} lane −${e.amount} Strength this round.`);
    }

  // Gather all ranged fire first (simultaneous), then apply.
  type Shot = { lane: Lane; points: number; source: string; at: 'warlord' | 'warlordApproach' | 'defender' };
  const shots: Shot[] = [];
  const resupply = sg.abilities.quartermasterResupply;
  const bonus = (lane: Lane) => (resupply === lane ? RULES.quartermasterResupply.bonus : 0);
  for (const lane of LANES) {
    const sheltered = laneUnderAttack(s, lane) ? shelteredTroops(s, lane).size : 0;
    if (sheltered) log(s, `🛡 Siege Tower shelters ${sheltered} troop(s) in the ${laneName(lane)} approach from ranged fire.`);
    const enemies = warlordTargets(s, lane).length;
    if (enemies) {
      for (const c of cornersCovering(lane)) {
        const t = s.towers[c];
        if (!t) continue;
        const td = building(t.buildingId).tower!;
        shots.push({ lane, points: td.shots + bonus(lane), source: `${building(t.buildingId).name} (${c}) fires on ${laneName(lane)}`, at: 'warlord' });
      }
      const archers = defendersIn(s, lane).filter((t) => troopDef(t.type).ranged);
      const ap = archers.reduce((a, t) => a + (troopDef(t.type).ranged ?? 0), 0);
      if (ap) shots.push({ lane, points: ap + bonus(lane), source: `Archers in the ${laneName(lane)} bailey`, at: 'warlord' });
      const gate = s.gates[lane];
      const mh = building(gate.buildingId).structure?.murderHoles ?? 0;
      if (mh && gate.hp > 0 && warlordTargets(s, lane, true).length)
        shots.push({ lane, points: mh + bonus(lane), source: `Gatehouse murder holes (${laneName(lane)})`, at: 'warlordApproach' });
    }
    // Warlord crossbows
    const xb = warlordTargets(s, lane, false, false).map((x) => (x as { t: Troop }).t).filter((t) => troopDef(t.type).ranged);
    const xp = xb.reduce((a, t) => a + (troopDef(t.type).ranged ?? 0), 0);
    if (xp && defenderTargets(s, lane).length) shots.push({ lane, points: xp, source: `Crossbowmen fire into the ${laneName(lane)} bailey`, at: 'defender' });
  }
  for (const p of plays) for (const e of card(p.cardId).effects) {
    if (e.type !== 'damageTroops') continue;
    if (sideOf(p.actor) === 'defender') shots.push({ lane: p.lane, points: e.amount + bonus(p.lane), source: card(p.cardId).name, at: 'warlordApproach' });
    else shots.push({ lane: p.lane, points: e.amount, source: card(p.cardId).name, at: 'defender' });
  }
  // Ranged engines (Trebuchets, Catapults) fire this step.
  const trebShots: { lane: Lane; amount: number; towerAmount: number; target: string; name: string }[] = [];
  for (const en of s.engines) {
    const e = card(en.cardId).effects.find((x) => x.type === 'engine');
    if (e?.ranged) trebShots.push({ lane: en.lane, amount: e.attack, towerAmount: e.towerAttack ?? e.attack, target: en.target, name: card(en.cardId).name });
  }
  // Burning oil destroys engines (simultaneous with trebuchet fire).
  const oil: Lane[] = [];
  for (const p of plays) for (const e of card(p.cardId).effects) if (e.type === 'destroyEngine') for (let i = 0; i < e.count; i++) oil.push(p.lane);

  for (const sh of shots) {
    const get = sh.at === 'defender' ? () => defenderTargets(s, sh.lane)
      : () => warlordTargets(s, sh.lane, sh.at === 'warlordApproach');
    dealDamage(s, get, sh.points, sh.source);
  }
  for (const t of trebShots) {
    if (t.target === 'tower') {
      // Focus fire: the most damaged tower covering the lane.
      const corner = cornersCovering(t.lane).filter((c) => s.towers[c]).sort((a, b) => s.towers[a]!.hp - s.towers[b]!.hp)[0];
      if (corner) {
        const tw = s.towers[corner]!;
        tw.hp -= t.towerAmount;
        log(s, `${t.name}: ${t.towerAmount} damage to the ${corner} ${building(tw.buildingId).name} → ${Math.max(0, tw.hp)}/${tw.maxHp}.`);
        if (tw.hp <= 0) { s.towers[corner] = null; log(s, `💥 The ${corner} tower collapses!`); }
        continue;
      }
    }
    if (!s.breached[t.lane]) damageStructure(s, t.lane, 'wall', t.amount, t.name);
  }
  for (const lane of oil) {
    const target = s.engines.filter((e) => e.lane === lane).sort((a, b) => engineAttack(b) - engineAttack(a))[0];
    if (target) {
      s.engines = s.engines.filter((e) => e.uid !== target.uid);
      log(s, `🔥 Burning Oil destroys a ${card(target.cardId).name} in the ${laneName(lane)} lane!`);
    } else log(s, `Burning Oil in the ${laneName(lane)} lane finds no engine.`);
  }
}

function engineAttack(e: { cardId: string }): number {
  return card(e.cardId).effects.find((x) => x.type === 'engine')?.attack ?? 0;
}

// ---------- Step 3: siege engines ----------

function stepEngines(s: GameState) {
  const sg = s.siege!;
  log(s, '— Siege engines —', 'all', 'step');
  for (const p of playsAt(s, 'engine')) for (const e of card(p.cardId).effects)
    if (e.type === 'damageStructure' && !s.breached[p.lane]) {
      const kind = e.structure as StructureKind;
      const dmg = e.ignoreDefense ? e.amount : Math.max(0, e.amount - structDefense(s, p.lane, kind));
      damageStructure(s, p.lane, kind, dmg, card(p.cardId).name);
    }
  const used: number[] = [];
  for (const lane of LANES) {
    if (s.breached[lane]) continue;
    for (const kind of ['gate', 'wall'] as StructureKind[]) {
      let total = 0;
      let pierce = 0;
      const names: string[] = [];
      for (const en of s.engines.filter((x) => x.lane === lane && x.target === kind)) {
        const e = card(en.cardId).effects.find((x) => x.type === 'engine')!;
        if (e.ranged) continue;
        if (e.blockedByMoat && s.moats[lane] && !sg.mods.bridge[lane]) {
          log(s, `The ${laneName(lane)} moat keeps the ${card(en.cardId).name} at bay.`);
          continue;
        }
        let atk = e.attack;
        if (en.cardId === 'battering_ram') atk -= building(s.walls[lane].buildingId).structure?.ramReduction ?? 0;
        total += Math.max(0, atk);
        pierce = Math.max(pierce, e.defensePierce ?? 0);
        names.push(card(en.cardId).name);
        if (e.oneUse) used.push(en.uid);
      }
      if (!names.length) continue;
      const def = Math.max(0, structDefense(s, lane, kind) - pierce);
      const dmg = Math.max(0, total - def);
      if (dmg > 0) damageStructure(s, lane, kind, dmg, `${names.join(' + ')} (${total} vs Defense ${def})`);
      else log(s, `${names.join(' + ')} (${total}) can't get past the ${laneName(lane)} ${kind}'s Defense ${def}.`);
    }
  }
  if (used.length) s.engines = s.engines.filter((e) => !used.includes(e.uid));
}

// ---------- Step 4: melee ----------

function laneDefenseBonus(s: GameState, lane: Lane): number {
  const sg = s.siege!;
  return (sg.mods.defense[lane] ?? 0) + (sg.rallyActive[lane] ?? 0);
}

function loseWeakestDefender(s: GameState, lane: Lane): string | null {
  const w = weakest(s, defendersIn(s, lane));
  if (w) { removeTroop(s, w); return troopDef(w.type).name; }
  if (knightIn(s, lane)) { defeatKnight(s); return 'the Knight'; }
  return null;
}

function loseWeakestWarlord(s: GameState, troops: Troop[]): string | null {
  const w = weakest(s, troops);
  if (w) { removeTroop(s, w); return troopDef(w.type).name; }
  return null;
}

function hasDefenders(s: GameState, lane: Lane) {
  return defendersIn(s, lane).length > 0 || knightIn(s, lane);
}

function stepMelee(s: GameState) {
  const sg = s.siege!;
  log(s, '— Melee clash —', 'all', 'step');
  const plays = playsAt(s, 'melee');
  for (const p of plays) {
    const c = card(p.cardId);
    if (c.requires && !hasBuilding(s, sideOf(p.actor), c.requires)) {
      p.fizzled = true;
      log(s, `${c.name} fizzles (requires ${building(c.requires).name}).`);
      continue;
    }
    deploy(s, p, 'melee');
  }
  const bestAttack: Partial<Record<Lane, number>> = {};
  for (const p of plays) {
    if (p.fizzled) continue;
    for (const e of card(p.cardId).effects) {
      if (e.type === 'defenseBonus') sg.mods.defense[p.lane] = (sg.mods.defense[p.lane] ?? 0) + e.amount;
      if (e.type === 'tempHp') s.gates[p.lane].tempHp += e.amount;
      if (e.type === 'attackBonus') {
        sg.mods.attack[p.lane] = (sg.mods.attack[p.lane] ?? 0) + e.amount;
        if (e.amount > (bestAttack[p.lane] ?? -1)) {
          bestAttack[p.lane] = e.amount;
          sg.mods.assaultTarget[p.lane] = (p.target === 'wall' ? 'wall' : 'gate');
        }
      }
    }
  }
  // Sally Forth
  for (const p of plays) {
    if (!card(p.cardId).effects.some((e) => e.type === 'sallyForth')) continue;
    if (!knightIn(s, p.lane)) { log(s, `Sally Forth: the Knight is not in the ${laneName(p.lane)} bailey — no sortie.`); continue; }
    const mine = baileyStrength(s, p.lane);
    const foes = troopsAt(s, 'warlord', p.lane, 'approach');
    const theirs = sumStrength(s, foes);
    if (!foes.length) { log(s, 'Sally Forth: no enemies in the approach.'); continue; }
    log(s, `⚔ Sally Forth in the ${laneName(p.lane)}: ${mine} vs ${theirs}.`);
    if (mine > theirs) log(s, `The sortie cuts down ${loseWeakestWarlord(s, foes)}.`);
    else if (theirs > mine) log(s, `The sortie is driven back; defenders lose ${loseWeakestDefender(s, p.lane)}.`);
    else log(s, 'The sortie ends in a stalemate.');
  }

  let keepDamage = 0;
  for (const lane of LANES) {
    const atkBonus = sg.mods.attack[lane] ?? 0;
    const defBonus = laneDefenseBonus(s, lane);
    if (!s.breached[lane]) {
      const foes = troopsAt(s, 'warlord', lane, 'approach');
      if (!foes.length || !laneUnderAttack(s, lane)) continue;
      const target: StructureKind = sg.mods.assaultTarget[lane] ?? (RULES.defaultTroopTarget as StructureKind);
      const attack = sumStrength(s, foes) + laneBuildingAttack(s, lane) + atkBonus;
      const troopsDef = baileyStrength(s, lane);
      const sDef = structDefense(s, lane, target);
      const tDef = towerDefense(s, lane);
      const defense = sDef + tDef + defBonus + troopsDef;
      log(s, `${laneName(lane)} assault on the ${target}: attack ${attack} vs defense ${defense} (structure ${sDef}, towers ${tDef}, cards/rally ${defBonus}, troops ${troopsDef}).`);
      const dmg = Math.max(0, attack - defense);
      if (dmg > 0) damageStructure(s, lane, target, dmg, `${laneName(lane)} assault`);
      if (hasDefenders(s, lane)) {
        if (attack < defense) log(s, `The attackers falter: the Warlord loses ${loseWeakestWarlord(s, foes)}.`);
        else if (defense < attack) log(s, `The defenders are pressed: they lose ${loseWeakestDefender(s, lane)}.`);
      }
    } else {
      const inside = troopsAt(s, 'warlord', lane, 'bailey');
      if (!inside.length) continue;
      const attack = sumStrength(s, inside) + atkBonus;
      if (hasDefenders(s, lane)) {
        const defense = baileyStrength(s, lane) + defBonus;
        log(s, `⚔ Fighting in the ${laneName(lane)} bailey: ${attack} vs ${defense}.`);
        const losses = baileyLosses(Math.abs(attack - defense));
        if (attack < defense) {
          const lost: string[] = [];
          for (let i = 0; i < losses; i++) { const x = loseWeakestWarlord(s, troopsAt(s, 'warlord', lane, 'bailey')); if (x) lost.push(x); }
          log(s, `The invaders are thrown back: the Warlord loses ${lost.join(', ')}.`);
        } else if (defense < attack) {
          const lost: string[] = [];
          for (let i = 0; i < losses; i++) { const x = loseWeakestDefender(s, lane); if (x) lost.push(x); }
          log(s, `The defenders give ground: they lose ${lost.join(', ')}.`);
          if (attack - defense >= RULES.bailey.buildingDestroyMargin) destroyBaileyBuilding(s, lane);
          if ((RULES.bailey as any).keepSpillover) {
            const spill = Math.max(0, attack - defense - s.keep.defense);
            if (spill > 0) {
              log(s, `🏰 The breakthrough carries on to the Keep: ${attack - defense} margin vs Keep Defense ${s.keep.defense} → ${spill} damage.`);
              keepDamage += spill;
            }
          }
        } else log(s, 'The fighting is even.');
      } else {
        const kd = Math.max(0, attack - s.keep.defense - defBonus);
        log(s, `🏰 ${inside.length} troop(s) from the ${laneName(lane)} bailey storm the Keep: ${attack} vs Defense ${s.keep.defense + defBonus} → ${kd} damage.`);
        keepDamage += kd;
      }
    }
  }
  if (keepDamage > 0) {
    s.keep.hp = Math.max(0, s.keep.hp - keepDamage);
    log(s, `The Keep takes ${keepDamage} damage → ${s.keep.hp}/${s.keep.maxHp}.`, 'all', 'keep');
  }
}

/** Fights inside the walls are bloody: 1 loss per `baileyPerMargin` points of margin (min 1). */
function baileyLosses(margin: number): number {
  const per = RULES.casualties?.baileyPerMargin ?? 0;
  return per > 0 ? Math.max(1, Math.ceil(margin / per)) : 1;
}

function destroyBaileyBuilding(s: GameState, lane: Lane) {
  const slots = s.baileys[lane];
  const cand = slots.map((b, i) => ({ b, i })).filter((x) => x.b)
    .sort((a, b) => costValue(a.b!.buildingId) - costValue(b.b!.buildingId));
  if (!cand.length) return;
  const x = cand[0];
  log(s, `🔥 The invaders burn the ${building(x.b!.buildingId).name} in the ${laneName(lane)} bailey.`);
  slots[x.i] = null;
}

function costValue(id: string) {
  return Object.values(building(id).cost).reduce((a, b) => a + b, 0);
}

// ---------- Step 5: recovery ----------

function repair(s: GameState, lane: Lane, kind: StructureKind | undefined, amount: number, source: string) {
  const pickKind = kind ?? (['wall', 'gate'] as StructureKind[])
    .filter((k) => struct(s, lane, k).hp > 0)
    .sort((a, b) => (struct(s, lane, b).maxHp - struct(s, lane, b).hp) - (struct(s, lane, a).maxHp - struct(s, lane, a).hp))[0];
  if (!pickKind) return;
  const st = struct(s, lane, pickKind);
  if (st.hp <= 0) { log(s, `${source}: the ${laneName(lane)} ${pickKind} is rubble and can't be repaired.`); return; }
  const before = st.hp;
  st.hp = Math.min(st.maxHp, st.hp + amount);
  log(s, `${source}: the ${laneName(lane)} ${pickKind} is repaired +${st.hp - before} → ${st.hp}/${st.maxHp}.`);
}

function stepRecovery(s: GameState) {
  const sg = s.siege!;
  log(s, '— Recovery —', 'all', 'step');
  for (const p of playsAt(s, 'recovery')) for (const e of card(p.cardId).effects)
    if (e.type === 'repair') repair(s, p.lane, p.target === 'wall' || p.target === 'gate' ? p.target : undefined, e.amount, card(p.cardId).name);
  const ar = sg.abilities.architectRepair;
  if (ar) repair(s, ar.lane, ar.structure, RULES.architectRepair.amount, 'Architect');
  const lr = sg.abilities.lordRally;
  if (lr && s.keep.hp > 0) {
    sg.rallyNext[lr] = (sg.rallyNext[lr] ?? 0) + RULES.lordRally.defense;
    log(s, `The Lord rallies the ${laneName(lr)} lane: +${RULES.lordRally.defense} Defense next round.`);
  }
}

// ---------- End of round & victory ----------

function endSiegeRound(s: GameState) {
  for (const l of LANES) { s.walls[l].tempHp = 0; s.gates[l].tempHp = 0; }
  checkVictory(s, true);
  if (s.winner) return;
  for (const a of ACTORS) drawTo(s, a, handSize(s, a));
  beginSiegeRound(s);
}

export function warlordHasTroopsLeft(s: GameState): boolean {
  if (s.troops.some((t) => t.side === 'warlord')) return true;
  const isTroopCard = (id: string) => card(id).effects.some((e) => e.type === 'deployTroops');
  return [...s.hands.warlord, ...s.siegeDecks.warlord].some(isTroopCard);
}

export function checkVictory(s: GameState, endOfRound: boolean) {
  if (s.winner) return;
  if (s.keep.hp <= 0) return endGame(s, 'warlord', 'The Keep has fallen and the Lord with it.');
  if (s.phase === 'siege' && !warlordHasTroopsLeft(s))
    return endGame(s, 'defender', 'The Warlord has no troops left to throw at the walls.');
  if (endOfRound && s.siegeRound >= RULES.siegeRounds)
    return endGame(s, 'defender', `The Keep held through all ${RULES.siegeRounds} siege rounds.`);
}

function endGame(s: GameState, winner: 'defender' | 'warlord', reason: string) {
  s.winner = winner;
  s.winReason = reason;
  s.phase = 'ended';
  s.step = 'ended';
  log(s, `🏁 ${winner === 'defender' ? 'DEFENDERS WIN' : 'THE WARLORD WINS'} — ${reason}`, 'all', 'end');
}

export { fmtRes };
