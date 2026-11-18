import * as B from './build';
import { BUILDINGS, MAP, RULES, TROOPS } from './data';
import * as S from './siege';
import * as K from './blockade';
import type { Action, Actor, CharacterId, GameState, Lane, SlotRef } from './types';
import { CHARACTERS, CORNERS, DEFENDER_RES, LANES, WARLORD_RES } from './types';
import { GameError, addRes, canAfford, clone, defendersIn, fail, hasBuilding, log, sideOf, troopsAt } from './util';

/** Pure reducer: returns a new state; throws GameError for illegal actions. */
export function applyAction(state: GameState, action: Action): GameState {
  if (state.winner && !action.type.startsWith('debug')) fail('The game is over');
  const s = clone(state);
  switch (action.type) {
    case 'setupDefenders': B.setupDefenders(s, action); break;
    case 'setupWarlord': B.setupWarlord(s, action); break;
    case 'chooseCharacter': B.chooseCharacter(s, action.character); break;
    case 'build': B.doBuild(s, action); break;
    case 'draft': B.doDraft(s, action); break;
    case 'draftPick': B.doDraftPick(s, action); break;
    case 'train': B.doTrain(s, action); break;
    case 'recruit': B.doRecruit(s, action); break;
    case 'move': B.doMove(s, action); break;
    case 'march': B.doMarch(s, action); break;
    case 'trade': B.doTrade(s, action); break;
    case 'decree': B.doDecree(s, action); break;
    case 'requisition': B.doRequisition(s, action); break;
    case 'raid': B.doRaid(s, action); break;
    case 'harass': B.doHarass(s, action); break;
    case 'endTurn': B.endTurn(s, action.actor); break;
    case 'soundHorns': B.doHornsDecision(s, true); break;
    case 'holdHorns': B.doHornsDecision(s, false); break;
    case 'planSiege': S.doPlanSiege(s, action); break;
    case 'advanceSiege': S.doAdvanceSiege(s); break;
    case 'debugGrant':
      addRes(s.stock[action.side], action.resources);
      log(s, `[debug] Granted resources to ${action.side}.`);
      break;
    case 'debugSkipToHorns': B.debugSkipToHorns(s); break;
    case 'debugSkipToAssault': K.debugSkipToAssault(s); break;
    case 'repair': K.doRepair(s, action); break;
    case 'scout': K.doScout(s, action); break;
    case 'levy': K.doLevy(s, action); break;
    case 'emplace': K.doEmplace(s, action); break;
    case 'stratagem': K.doStratagem(s, action); break;
    case 'orderAssault': K.doAssaultDecision(s, true); break;
    case 'holdSiege': K.doAssaultDecision(s, false); break;
    default: fail(`Unknown action ${(action as any).type}`);
  }
  return s;
}

export function tryAction(state: GameState, action: Action): { ok: true; state: GameState } | { ok: false; error: string } {
  try {
    return { ok: true, state: applyAction(state, action) };
  } catch (e) {
    if (e instanceof GameError) return { ok: false, error: e.message };
    throw e;
  }
}

export function isLegal(state: GameState, action: Action): boolean {
  return tryAction(state, action).ok;
}

/** Who needs to act right now. In 'chooseCharacter', any defender character not done may be picked. */
export function pendingActors(s: GameState): Actor[] {
  if (s.winner) return [];
  switch (s.step) {
    case 'setup': {
      const out: Actor[] = [];
      if (!s.setupDone.defender) out.push(...CHARACTERS);
      if (!s.setupDone.warlord) out.push('warlord');
      return out;
    }
    case 'chooseCharacter': return CHARACTERS.filter((c) => !s.turn.done.includes(c));
    case 'defenderTurn': return [s.turn.current!];
    case 'draftPick': return [s.pendingDraft!.actor];
    case 'warlordTurn':
    case 'hornsDecision':
    case 'assaultDecision': return ['warlord'];
    case 'siege': {
      const sg = s.siege!;
      if (sg.stage === 'plan') return ([...CHARACTERS, 'warlord'] as Actor[]).filter((a) => !sg.planned.includes(a));
      return [];
    }
    default: return [];
  }
}

// ---------- Legal-action enumeration (used by the AI and the UI) ----------

export function allSlots(side: 'defender' | 'warlord'): SlotRef[] {
  const out: SlotRef[] = [];
  if (side === 'warlord') {
    for (const l of LANES) for (let i = 0; i < MAP.approachSlots[l]; i++) out.push({ kind: 'approach', lane: l, index: i });
  } else {
    for (const l of LANES) for (let i = 0; i < MAP.baileySlots[l]; i++) out.push({ kind: 'bailey', lane: l, index: i });
    for (const c of CORNERS) out.push({ kind: 'tower', corner: c });
    for (const l of LANES) out.push({ kind: 'wall', lane: l }, { kind: 'gate', lane: l }, { kind: 'moat', lane: l });
  }
  return out;
}

export function legalBuildsForSlot(s: GameState, actor: Actor, slot: SlotRef): Action[] {
  const side = sideOf(actor);
  const out: Action[] = [];
  for (const b of Object.values(BUILDINGS)) {
    if (b.side !== side || b.slot !== slot.kind || b.buildable === false) continue;
    const variants = b.chooseTroopType
      ? Object.values(TROOPS).filter((t) => t.side === 'defender').map((t) => t.id)
      : [undefined];
    for (const troopType of variants) {
      const a: Action = { type: 'build', actor, slot, buildingId: b.id, ...(troopType ? { troopType } : {}) };
      if (isLegal(s, a)) out.push(a);
    }
  }
  return out;
}

/**
 * Enumerate a useful set of legal build-phase actions for the actor (not every possible
 * troop subset for moves — single-troop and whole-bailey moves only).
 */
export function legalBuildActions(s: GameState, actor: Actor): Action[] {
  const out: Action[] = [];
  const push = (a: Action) => { if (isLegal(s, a)) out.push(a); };
  if (s.step === 'draftPick') {
    if (s.pendingDraft?.actor === actor) s.pendingDraft.cards.forEach((_, i) => out.push({ type: 'draftPick', actor, index: i }));
    return out;
  }
  if (s.step === 'hornsDecision' && actor === 'warlord') return [{ type: 'soundHorns' }, { type: 'holdHorns' }];
  if (s.step === 'assaultDecision' && actor === 'warlord') return [{ type: 'orderAssault' }, { type: 'holdSiege' }];
  const side = sideOf(actor);
  for (const slot of allSlots(side)) out.push(...legalBuildsForSlot(s, actor, slot));
  for (const deck of Object.keys((RULES.draftCosts as any)[side])) push({ type: 'draft', actor, deck });
  const resList = side === 'defender' ? DEFENDER_RES : WARLORD_RES;
  for (const give of resList) for (const get of resList) if (give !== get) push({ type: 'trade', actor, give, get });
  if (actor === 'warlord') {
    for (const t of Object.values(TROOPS)) if (t.side === 'warlord') for (const l of LANES) for (let n = 1; n <= (RULES.recruitPerAction ?? 1); n++) push({ type: 'recruit', troop: t.id, lane: l, count: n });
    for (const from of LANES) {
      const here = troopsAt(s, 'warlord', from, 'approach');
      if (!here.length) continue;
      for (const to of MAP.adjacency[from]) push({ type: 'march', from, to, troopUids: here.slice(0, RULES.marchMaxTroops).map((t) => t.uid) });
    }
    for (const l of LANES) push({ type: 'harass', lane: l });
    if (s.phase === 'blockade') {
      for (const id of new Set(s.siegeDecks.warlord)) for (const l of LANES) {
        push({ type: 'emplace', cardId: id, lane: l });
        push({ type: 'stratagem', cardId: id, lane: l });
        for (const to of MAP.adjacency[l]) push({ type: 'stratagem', cardId: id, lane: l, to });
      }
    }
  } else {
    const c = actor as CharacterId;
    for (const t of Object.values(TROOPS)) if (t.side === 'defender') for (const l of LANES) push({ type: 'train', actor: c, troop: t.id, lane: l });
    for (const from of LANES) for (const to of MAP.adjacency[from]) {
      const here = defendersIn(s, from);
      if (here.length) push({ type: 'move', actor: c, from, to });
      if (here.length > 1) push({ type: 'move', actor: c, from, to, troopUids: [here[0].uid] });
      if (s.knight.lane === from) push({ type: 'move', actor: c, from, to, troopUids: [], includeKnight: true });
    }
    if (c === 'lord') for (const r of DEFENDER_RES) push({ type: 'decree', actor: 'lord', resource: r });
    if (c === 'quartermaster')
      for (const give of DEFENDER_RES) for (const get of DEFENDER_RES) if (give !== get)
        push({ type: 'requisition', actor: 'quartermaster', give, get, amount: Math.min(RULES.requisitionMax, s.stock.defender[give] ?? 0) });
    if (c === 'knight') for (const l of LANES) {
      const party = defendersIn(s, l).slice(0, RULES.raid.maxTroops).map((t) => t.uid);
      push({ type: 'raid', actor: 'knight', lane: l, troopUids: party });
      for (const e of s.engines.filter((x) => x.lane === l)) push({ type: 'raid', actor: 'knight', lane: l, troopUids: party, targetEngineUid: e.uid });
    }
    for (const l of LANES) {
      push({ type: 'repair', actor: c, lane: l, structure: 'wall' });
      push({ type: 'repair', actor: c, lane: l, structure: 'gate' });
      push({ type: 'repair', actor: c, lane: l, structure: 'tower' });
      if (s.phase === 'blockade') { push({ type: 'scout', actor: c, lane: l }); push({ type: 'levy', actor: c, lane: l }); }
    }
  }
  out.push({ type: 'endTurn', actor });
  return out;
}

export function draftAvailable(s: GameState, side: 'defender' | 'warlord', deck: string): { ok: boolean; reason?: string } {
  const info = (RULES.draftCosts as any)[side][deck];
  if (info.requires && !hasBuilding(s, side, info.requires)) return { ok: false, reason: `needs ${BUILDINGS[info.requires].name}` };
  if (!s.draftDecks[side][deck]?.length) return { ok: false, reason: 'deck empty' };
  if (!canAfford(s.stock[side], info.cost)) return { ok: false, reason: 'cannot afford' };
  return { ok: true };
}

export type { Lane };
