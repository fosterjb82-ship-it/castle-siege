import { applyAction, pendingActors } from '../engine';
import type { Action, Actor, CharacterId, GameState } from '../types';
import { CHARACTERS } from '../types';
import { isAI } from '../util';
import { defenderAI } from './defender';
import { warlordAI } from './warlord';

export { warlordTargetLane, laneThreat } from './common';

export function aiAction(s: GameState, actor: Actor): Action {
  return actor === 'warlord' ? warlordAI(s) : defenderAI(s, actor as CharacterId);
}

/**
 * Advance the game while the actor who must move is AI-controlled.
 * With autoResolve, siege resolution steps are also advanced automatically.
 */
export function runAI(state: GameState, opts: { autoResolve?: boolean; maxSteps?: number } = {}): GameState {
  let s = state;
  const max = opts.maxSteps ?? 5000;
  for (let i = 0; i < max && !s.winner; i++) {
    if (s.step === 'siege' && s.siege!.stage === 'resolve') {
      if (!opts.autoResolve) break;
      s = applyAction(s, { type: 'advanceSiege' });
      continue;
    }
    const pending = pendingActors(s);
    if (!pending.length) break;
    let actor: Actor | undefined;
    if (s.step === 'chooseCharacter' || (s.step === 'setup' && pending.includes('lord'))) {
      const defenders = pending.filter((a) => a !== 'warlord') as CharacterId[];
      if (s.step === 'chooseCharacter') {
        if (defenders.every((c) => isAI(s, c))) actor = defenders[0];
      } else if (CHARACTERS.every((c) => isAI(s, c))) actor = 'lord';
      if (!actor && s.step === 'setup' && pending.includes('warlord') && isAI(s, 'warlord')) actor = 'warlord';
    } else {
      actor = pending.find((a) => isAI(s, a));
    }
    if (!actor) break;
    s = applyAction(s, aiAction(s, actor));
  }
  return s;
}
