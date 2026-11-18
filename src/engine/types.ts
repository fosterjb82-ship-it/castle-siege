// Core types for the Castle Siege rules engine. No UI dependencies.

export type Lane = 'N' | 'E' | 'S' | 'W';
export type Corner = 'NE' | 'NW' | 'SE' | 'SW';
export type Side = 'defender' | 'warlord';
export type CharacterId = 'lord' | 'architect' | 'quartermaster' | 'knight';
export type Actor = CharacterId | 'warlord';
export type Speed = 'scout' | 'ranged' | 'engine' | 'melee' | 'recovery';
export type StructureKind = 'wall' | 'gate';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type Mode = 'coop' | 'warlord';

export const LANES: Lane[] = ['N', 'E', 'S', 'W'];
export const CORNERS: Corner[] = ['NE', 'NW', 'SE', 'SW'];
export const CHARACTERS: CharacterId[] = ['lord', 'architect', 'quartermaster', 'knight'];
export const DEFENDER_RES = ['stone', 'wood', 'gold', 'food'] as const;
export const WARLORD_RES = ['supplies', 'timber', 'gold'] as const;

export type Resources = Record<string, number>;

// ---------- Data records ----------

export interface Effect {
  type: string;
  [k: string]: any;
}

export interface CardDef {
  id: string;
  name: string;
  side: Side;
  deck: string;
  speed: Speed;
  laneRule: 'any' | Lane | 'none';
  target: string;
  effects: Effect[];
  copies: number;
  text: string;
  requires?: string;
  character?: CharacterId;
  basic?: boolean;
}

export interface BuildingDef {
  id: string;
  side: Side;
  name: string;
  slot: 'bailey' | 'tower' | 'wall' | 'gate' | 'moat' | 'approach';
  category: string;
  cost: Resources;
  buildable?: boolean;
  upgradeOf?: string;
  structure?: { defense: number; hp: number; ramReduction?: number; murderHoles?: number };
  tower?: { defense: number; shots: number; hp: number };
  produces?: Resources;
  supplyRating?: number;
  laneAttack?: number;
  recruitHere?: boolean;
  recruitDiscount?: Resources;
  troopStrengthBonus?: number;
  chooseTroopType?: boolean;
  firstInMainCampLane?: boolean;
  handSizeBonus?: number;
  garrisonCapacity?: number;
  indestructible?: boolean;
  text: string;
}

export interface TroopDef {
  id: string;
  side: Side;
  name: string;
  strength: number;
  hp: number;
  cost: Resources;
  requires?: string;
  ranged?: number;
  freeMarch?: boolean;
}

// ---------- State ----------

export interface Structure {
  buildingId: string;
  hp: number;
  maxHp: number;
  tempHp: number;
}

export interface PlacedBuilding {
  uid: number;
  buildingId: string;
  troopType?: string; // weaponsmith choice
}

export interface PlacedTower extends PlacedBuilding {
  hp: number;
  maxHp: number;
}

export interface Troop {
  uid: number;
  type: string;
  side: Side;
  lane: Lane;
  zone: 'bailey' | 'approach';
  hp: number;
}

export interface Knight {
  lane: Lane | null; // null = in the Keep
  hp: number;
  downUntilSiegeRound: number | null; // defeated: unavailable until this siege round
}

export interface Engine {
  uid: number;
  cardId: string;
  lane: Lane;
  hp: number;
  target: 'gate' | 'wall' | 'tower';
}

export interface PlayerSlot {
  name: string;
  controls: Actor[];
  ai?: boolean;
}

export interface GameConfig {
  mode: Mode;
  difficulty: Difficulty;
  players: PlayerSlot[];
}

export interface LogEntry {
  text: string;
  vis: 'all' | Side;
  tag?: string;
}

export interface SiegePlay {
  actor: Actor;
  cardId: string;
  lane: Lane;
  target?: 'gate' | 'wall' | 'tower';
  spyTarget?: CharacterId;
  fallback?: boolean;
  fizzled?: boolean;
}

export interface PlannedMove {
  side: Side;
  troopUids: number[];
  from: Lane;
  to: Lane; // warlord: same lane (approach -> breached bailey)
}

export interface AbilityPlan {
  lordRally?: Lane;
  architectRepair?: { lane: Lane; structure: StructureKind };
  quartermasterResupply?: Lane;
  knightMove?: Lane;
}

export interface CardPlanInput {
  cardId: string;
  lane: Lane;
  target?: 'gate' | 'wall' | 'tower';
  spyTarget?: CharacterId;
  fallback?: boolean;
}

export type SiegeStage = 'plan' | 'resolve';
export const RESOLVE_STEPS = ['reveal', 'scout', 'ranged', 'engine', 'melee', 'recovery'] as const;
export type ResolveStep = (typeof RESOLVE_STEPS)[number];

export interface SiegeState {
  stage: SiegeStage;
  planned: Actor[];
  plays: SiegePlay[];
  moves: PlannedMove[];
  abilities: AbilityPlan;
  nextStep: number; // index into RESOLVE_STEPS
  rallyActive: Partial<Record<Lane, number>>; // Lord rally from the previous round
  rallyNext: Partial<Record<Lane, number>>;
  mods: RoundMods;
}

export interface RoundMods {
  attack: Partial<Record<Lane, number>>;
  defense: Partial<Record<Lane, number>>;
  caltrops: Partial<Record<Lane, number>>;
  gateDebuff: Partial<Record<Lane, number>>;
  bridge: Partial<Record<Lane, boolean>>;
  assaultTarget: Partial<Record<Lane, StructureKind>>;
  /** Lanes the Warlord commits to this round (a card played, an engine, or troops inside). */
  underAttack: Partial<Record<Lane, boolean>>;
}

export type BuildStep =
  | 'setup'
  | 'chooseCharacter'
  | 'defenderTurn'
  | 'warlordTurn'
  | 'hornsDecision'
  | 'assaultDecision'
  | 'draftPick';

export interface TurnState {
  done: CharacterId[];
  current: CharacterId | null;
  actionsLeft: number;
  warlordActionsLeft: number;
  abilityUsed: Partial<Record<CharacterId, boolean>>;
  returnStep: BuildStep | null; // where to go after a draft pick
}

export interface GameStats {
  firstBreach: { lane: Lane; siegeRound: number } | null;
  breaches: { lane: Lane; siegeRound: number }[];
  cardsPlayed: Record<string, number>;
  drafted: Record<string, number>;
  hornsRound: number | null;
  /** Siege (blockade) rounds played before the Assault. */
  blockadeRounds: number;
  hungryRounds: number;
  stratagems: number;
  assaultForced: boolean;
  raids: { won: number; lost: number };
}

export interface GameState {
  version: 1;
  seed: number;
  rng: number;
  config: GameConfig;
  /** 'blockade' is the Siege phase of GDD v0.2; 'siege' is the Assault phase (kept as the internal ID). */
  phase: 'setup' | 'build' | 'blockade' | 'siege' | 'ended';
  step: BuildStep | 'siege' | 'ended';
  setupDone: Partial<Record<Side, boolean>>;
  setupHidden: { defender?: Lane[]; warlord?: { camp: Lane; footmen: Lane[] } };
  round: number;
  finalBuildRound: boolean;
  hornsSounded: boolean;
  siegeRound: number;
  stock: { defender: Resources; warlord: Resources };
  walls: Record<Lane, Structure>;
  gates: Record<Lane, Structure>;
  keep: { defense: number; hp: number; maxHp: number };
  towers: Record<Corner, PlacedTower | null>;
  baileys: Record<Lane, (PlacedBuilding | null)[]>;
  approaches: Record<Lane, (PlacedBuilding | null)[]>;
  moats: Record<Lane, boolean>;
  breached: Record<Lane, boolean>;
  troops: Troop[];
  knight: Knight;
  engines: Engine[];
  draftDecks: { defender: Record<string, string[]>; warlord: Record<string, string[]> };
  siegeDecks: Record<Actor, string[]>;
  hands: Record<Actor, string[]>;
  intel: { side: Side; text: string; round: number }[];
  /** Townsfolk who can still be levied as Militia beyond the Garrison Capacity. */
  population: number;
  /** The garrison couldn't be fed this round: every defender troop −1 Strength. */
  hungry: boolean;
  /** Relief army clock: starts at the War Horns; defenders win when it reaches 0 with the Keep standing. */
  relief: { roundsLeft: number } | null;
  /**
   * Siege (blockade) state. Defenders see max(0, actual + offset) Warlord troops in each approach;
   * Night March and Campfires create offsets, scouting or a sortie clears them, the Assault reveals all.
   */
  blockade: { round: number; offsets: Record<Lane, number>; scouted: Lane[] } | null;
  turn: TurnState;
  pendingDraft: { actor: Actor; deck: string; cards: string[] } | null;
  harassed: number[];
  siege: SiegeState | null;
  log: LogEntry[];
  winner: Side | null;
  winReason: string;
  nextUid: number;
  stats: GameStats;
}

// ---------- Actions ----------

export type SlotRef =
  | { kind: 'bailey'; lane: Lane; index: number }
  | { kind: 'approach'; lane: Lane; index: number }
  | { kind: 'tower'; corner: Corner }
  | { kind: 'wall'; lane: Lane }
  | { kind: 'gate'; lane: Lane }
  | { kind: 'moat'; lane: Lane };

export type Action =
  | { type: 'setupDefenders'; militia: Lane[]; knight?: Lane }
  | { type: 'setupWarlord'; camp: Lane; footmen: Lane[] }
  | { type: 'chooseCharacter'; character: CharacterId }
  | { type: 'build'; actor: Actor; slot: SlotRef; buildingId: string; troopType?: string }
  | { type: 'draft'; actor: Actor; deck: string }
  | { type: 'draftPick'; actor: Actor; index: number }
  | { type: 'train'; actor: CharacterId; troop: string; lane: Lane }
  | { type: 'recruit'; troop: string; lane: Lane; count?: number }
  | { type: 'move'; actor: CharacterId; from: Lane; to: Lane; troopUids?: number[]; includeKnight?: boolean }
  | { type: 'march'; from: Lane; to: Lane; troopUids: number[] }
  | { type: 'trade'; actor: Actor; give: string; get: string }
  | { type: 'decree'; actor: 'lord'; resource: string }
  | { type: 'requisition'; actor: 'quartermaster'; give: string; get: string; amount: number }
  | { type: 'raid'; actor: 'knight'; lane: Lane; troopUids: number[]; targetBuildingUid?: number; targetEngineUid?: number }
  | { type: 'repair'; actor: CharacterId; lane: Lane; structure: StructureKind | 'tower'; corner?: Corner }
  | { type: 'scout'; actor: CharacterId; lane: Lane }
  | { type: 'levy'; actor: CharacterId; lane: Lane }
  | { type: 'emplace'; cardId: string; lane: Lane; target?: 'gate' | 'wall' | 'tower' }
  | { type: 'stratagem'; cardId: string; lane: Lane; to?: Lane; count?: number }
  | { type: 'orderAssault' }
  | { type: 'holdSiege' }
  | { type: 'harass'; lane: Lane; buildingUid?: number }
  | { type: 'endTurn'; actor: Actor }
  | { type: 'soundHorns' }
  | { type: 'holdHorns' }
  | {
      type: 'planSiege';
      actor: Actor;
      cards: CardPlanInput[];
      moves?: { troopUids: number[]; from: Lane; to: Lane }[];
      ability?: AbilityPlan;
    }
  | { type: 'advanceSiege' }
  // debug actions
  | { type: 'debugGrant'; side: Side; resources: Resources }
  | { type: 'debugSkipToHorns' }
  | { type: 'debugSkipToAssault' };
