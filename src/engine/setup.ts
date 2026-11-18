import { CARDS, MAP, RULES, building } from './data';
import { hashSeed, shuffle } from './rng';
import type { Actor, Difficulty, GameConfig, GameState, Lane, Mode, PlayerSlot, Structure } from './types';
import { CHARACTERS, CORNERS, LANES } from './types';
import { log } from './util';

export interface NewGameOptions {
  mode?: Mode;
  difficulty?: Difficulty;
  seed?: number | string;
  /** Player slots. Default: one human controlling all four characters, AI Warlord. */
  players?: PlayerSlot[];
}

function structure(id: string): Structure {
  const st = building(id).structure!;
  return { buildingId: id, hp: st.hp, maxHp: st.hp, tempHp: 0 };
}

function perLane<T>(f: (l: Lane) => T): Record<Lane, T> {
  return Object.fromEntries(LANES.map((l) => [l, f(l)])) as Record<Lane, T>;
}

export function defaultPlayers(mode: Mode, humanDefenders = 1): PlayerSlot[] {
  const slots: PlayerSlot[] = [];
  const n = Math.max(1, Math.min(4, humanDefenders));
  for (let i = 0; i < n; i++) slots.push({ name: `Player ${i + 1}`, controls: [] });
  CHARACTERS.forEach((c, i) => slots[i % n].controls.push(c));
  slots.push(mode === 'coop'
    ? { name: 'AI Warlord', controls: ['warlord'], ai: true }
    : { name: 'Warlord', controls: ['warlord'] });
  return slots;
}

export function createGame(opts: NewGameOptions = {}): GameState {
  const mode = opts.mode ?? 'coop';
  const seed = opts.seed === undefined ? Math.floor(Math.random() * 2 ** 31) : hashSeed(opts.seed);
  const config: GameConfig = {
    mode,
    difficulty: opts.difficulty ?? 'normal',
    players: opts.players ?? defaultPlayers(mode),
  };
  const ks = MAP.startingStructures.keep;
  const empty = (): Record<Actor, string[]> => ({ lord: [], architect: [], quartermaster: [], knight: [], warlord: [] });

  const s: GameState = {
    version: 1,
    seed,
    rng: seed,
    config,
    phase: 'setup',
    step: 'setup',
    setupDone: {},
    setupHidden: {},
    round: 0,
    finalBuildRound: false,
    hornsSounded: false,
    siegeRound: 0,
    stock: { defender: { ...RULES.startingResources.defender }, warlord: { ...RULES.startingResources.warlord } },
    walls: perLane(() => structure(MAP.startingStructures.wall)),
    gates: perLane(() => structure(MAP.startingStructures.gate)),
    keep: { defense: ks.defense, hp: ks.hp, maxHp: ks.hp },
    towers: Object.fromEntries(CORNERS.map((c) => [c, null])) as GameState['towers'],
    baileys: perLane((l) => Array(MAP.baileySlots[l]).fill(null)),
    approaches: perLane((l) => Array(MAP.approachSlots[l]).fill(null)),
    moats: perLane(() => false),
    breached: perLane(() => false),
    troops: [],
    knight: { lane: null, hp: RULES.knight.hp, downUntilSiegeRound: null },
    engines: [],
    draftDecks: { defender: {}, warlord: {} },
    siegeDecks: empty(),
    hands: empty(),
    intel: [],
    turn: { done: [], current: null, actionsLeft: 0, warlordActionsLeft: 0, abilityUsed: {}, returnStep: null },
    pendingDraft: null,
    harassed: [],
    siege: null,
    log: [],
    winner: null,
    winReason: '',
    nextUid: 1,
    stats: { firstBreach: null, breaches: [], cardsPlayed: {}, drafted: {}, hornsRound: null, raids: { won: 0, lost: 0 } },
  };

  // Draft decks from card copies.
  for (const c of Object.values(CARDS)) {
    if (c.basic || c.copies <= 0) continue;
    const decks = s.draftDecks[c.side];
    (decks[c.deck] ??= []);
    for (let i = 0; i < c.copies; i++) decks[c.deck].push(c.id);
  }
  for (const side of ['defender', 'warlord'] as const)
    for (const d of Object.keys(s.draftDecks[side])) shuffle(s, s.draftDecks[side][d]);

  // Starter siege decks.
  for (const ch of CHARACTERS)
    for (const [id, n] of Object.entries(RULES.starterSiegeCards.defenderPerCharacter))
      for (let i = 0; i < n; i++) s.siegeDecks[ch].push(id);
  for (const [id, n] of Object.entries(RULES.starterSiegeCards.warlord))
    for (let i = 0; i < n; i++) s.siegeDecks.warlord.push(id);

  log(s, `New ${mode === 'coop' ? 'co-op' : 'Warlord'} game (seed ${seed}, ${config.difficulty}).`);
  log(s, 'Setup: defenders place 3 Militia; the Warlord places the Main Siege Camp and 3 Footmen (hidden, simultaneous).');
  return s;
}
