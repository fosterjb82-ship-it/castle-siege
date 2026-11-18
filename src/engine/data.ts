import rulesJson from '../../data/rules.json';
import mapJson from '../../data/map.standard.json';
import buildingsJson from '../../data/buildings.json';
import troopsJson from '../../data/troops.json';
import defCardsJson from '../../data/cards.defender.json';
import warCardsJson from '../../data/cards.warlord.json';
import charactersJson from '../../data/characters.json';
import type { BuildingDef, CardDef, CharacterId, Corner, Lane, TroopDef } from './types';

export const RULES = rulesJson as typeof rulesJson;

export interface MapDef {
  id: string;
  name: string;
  lanes: Lane[];
  laneNames: Record<Lane, string>;
  adjacency: Record<Lane, Lane[]>;
  approachSlots: Record<Lane, number>;
  baileySlots: Record<Lane, number>;
  towers: Record<Corner, { covers: Lane[] }>;
  startingStructures: { wall: string; gate: string; keep: { defense: number; hp: number } };
}
export const MAP = mapJson as unknown as MapDef;

export const BUILDINGS: Record<string, BuildingDef> = Object.fromEntries(
  (buildingsJson as unknown as BuildingDef[]).map((b) => [b.id, b]),
);
export const TROOPS: Record<string, TroopDef> = Object.fromEntries(
  (troopsJson as unknown as TroopDef[]).map((t) => [t.id, t]),
);
export const CARDS: Record<string, CardDef> = Object.fromEntries(
  [...(defCardsJson as unknown as CardDef[]), ...(warCardsJson as unknown as CardDef[])].map((c) => [c.id, c]),
);

export interface CharacterDef {
  id: CharacterId;
  name: string;
  ability: string | null;
  abilityText: string;
  passive?: { type: string; resource: string; amount: number; categories?: string[] };
  passiveText: string;
  siegeText: string;
}
export const CHARACTER_DEFS: Record<CharacterId, CharacterDef> = Object.fromEntries(
  (charactersJson as unknown as CharacterDef[]).map((c) => [c.id, c]),
) as Record<CharacterId, CharacterDef>;

export function card(id: string): CardDef {
  const c = CARDS[id];
  if (!c) throw new Error(`Unknown card ${id}`);
  return c;
}
export function building(id: string): BuildingDef {
  const b = BUILDINGS[id];
  if (!b) throw new Error(`Unknown building ${id}`);
  return b;
}
export function troopDef(id: string): TroopDef {
  const t = TROOPS[id];
  if (!t) throw new Error(`Unknown troop ${id}`);
  return t;
}
export function laneName(l: Lane): string {
  return MAP.laneNames[l];
}
