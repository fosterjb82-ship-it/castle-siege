import { CHARACTER_DEFS, card, laneName, pendingActors, util } from '../engine';
import type { Actor, GameState, LogEntry, Resources, Side } from '../engine';

export const SPEED_ICON: Record<string, string> = { scout: '🔍', ranged: '🏹', engine: '⚙️', melee: '⚔️', recovery: '✚' };
export const RES_ICON: Record<string, string> = { stone: '🪨', wood: '🪵', gold: '🪙', supplies: '🍖', timber: '🌲', food: '🍞' };

export function actorName(a: Actor): string {
  return a === 'warlord' ? 'Warlord' : CHARACTER_DEFS[a].name;
}

export function resText(r: Resources): string {
  const parts = Object.entries(r).filter(([, v]) => v).map(([k, v]) => `${v}${RES_ICON[k] ?? ' ' + k}`);
  return parts.length ? parts.join(' ') : 'free';
}

export function cardName(id: string) {
  return card(id).name;
}

export { laneName };

/** Viewer = whose hidden information may be shown. 'all' when debug reveal is on. */
export type Viewer = Side | 'all' | 'public';

export function canSee(viewer: Viewer, vis: LogEntry['vis']): boolean {
  return viewer === 'all' || vis === 'all' || vis === viewer;
}

/** The human-controlled actor who should act next (for privacy screens and panels). */
export function activeHumanActor(s: GameState): Actor | null {
  const pending = pendingActors(s);
  if (!pending.length) return null;
  if (s.step === 'siege') {
    const order: Actor[] = ['lord', 'architect', 'quartermaster', 'knight', 'warlord'];
    return order.find((a) => pending.includes(a) && !util.isAI(s, a)) ?? null;
  }
  if (s.step === 'setup') {
    if (pending.includes('lord') && !util.isAI(s, 'lord')) return 'lord';
    if (pending.includes('warlord') && !util.isAI(s, 'warlord')) return 'warlord';
    return null;
  }
  return pending.find((a) => !util.isAI(s, a)) ?? null;
}

/** The AI actor who should act next, if any (and no human is needed first). */
export function activeAIActor(s: GameState): Actor | null {
  const pending = pendingActors(s);
  if (!pending.length) return null;
  if (s.step === 'chooseCharacter') {
    return pending.every((a) => util.isAI(s, a)) ? pending[0] : null;
  }
  if (s.step === 'setup') {
    if (pending.includes('warlord') && util.isAI(s, 'warlord')) return 'warlord';
    if (pending.includes('lord') && util.isAI(s, 'lord')) return 'lord';
    return null;
  }
  if (s.step === 'siege') {
    const order: Actor[] = ['lord', 'architect', 'quartermaster', 'knight', 'warlord'];
    return order.find((a) => pending.includes(a) && util.isAI(s, a)) ?? null;
  }
  return pending.find((a) => util.isAI(s, a)) ?? null;
}

/** Name of the player who controls the actor. */
export function playerOf(s: GameState, a: Actor): string {
  return util.controllerOf(s, a)?.name ?? actorName(a);
}

export function download(filename: string, text: string, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const el = document.createElement('a');
  el.href = url;
  el.download = filename;
  el.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function logText(s: GameState, viewer: Viewer): string {
  return s.log.filter((l) => canSee(viewer, l.vis)).map((l) => (l.vis !== 'all' ? `[${l.vis} only] ` : '') + l.text).join('\n');
}
