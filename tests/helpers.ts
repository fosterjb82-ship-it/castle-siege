import { applyAction, createGame } from '../src/engine';
import type { Action, GameState, Lane } from '../src/engine';

export function newGame(seed = 42, mode: 'coop' | 'warlord' = 'warlord'): GameState {
  return createGame({ seed, mode });
}

/** A game past setup: militia N/E/S, knight N; camp S with footmen S,S,E. */
export function afterSetup(seed = 42): GameState {
  let s = newGame(seed);
  s = applyAction(s, { type: 'setupDefenders', militia: ['N', 'E', 'S'], knight: 'N' });
  s = applyAction(s, { type: 'setupWarlord', camp: 'S', footmen: ['S', 'S', 'E'] });
  return s;
}

export function act(s: GameState, ...actions: Action[]): GameState {
  for (const a of actions) s = applyAction(s, a);
  return s;
}

/** Start a character's turn. */
export function turn(s: GameState, c: 'lord' | 'architect' | 'quartermaster' | 'knight'): GameState {
  return applyAction(s, { type: 'chooseCharacter', character: c });
}

export function passAll(s: GameState): GameState {
  // Finish the current build round with every actor passing.
  while ((s.phase === 'build' || s.phase === 'blockade') && s.step !== 'hornsDecision' && s.step !== 'assaultDecision') {
    if (s.step === 'chooseCharacter') {
      const c = (['lord', 'architect', 'quartermaster', 'knight'] as const).find((x) => !s.turn.done.includes(x))!;
      s = applyAction(s, { type: 'chooseCharacter', character: c });
    } else if (s.step === 'defenderTurn') s = applyAction(s, { type: 'endTurn', actor: s.turn.current! });
    else if (s.step === 'warlordTurn') s = applyAction(s, { type: 'endTurn', actor: 'warlord' });
    else break;
    if (s.turn.done.length === 0 && s.step === 'chooseCharacter') break; // new round started
  }
  return s;
}

/** Straight to the Assault (internal phase 'siege'): horns, then the Assault is ordered at once. */
export function toSiege(s: GameState): GameState {
  return applyAction(s, { type: 'debugSkipToAssault' });
}

/** Sound the horns and stop at the first Siege (blockade) round. */
export function toBlockade(s: GameState): GameState {
  return applyAction(s, { type: 'debugSkipToHorns' });
}

export const L = (x: string) => x as Lane;
