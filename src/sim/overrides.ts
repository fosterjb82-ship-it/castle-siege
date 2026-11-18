// Apply partial data overrides at runtime (for balance experiments without editing /data).
// File shape: { "rules": {...}, "buildings": { "<id>": {...} }, "troops": {...}, "cards": {...}, "map": {...} }
import { BUILDINGS, CARDS, MAP, RULES, TROOPS } from '../engine/data';

function deepMerge(target: any, src: any) {
  for (const [k, v] of Object.entries(src ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') deepMerge(target[k], v);
    else target[k] = v;
  }
}

export interface DataOverrides {
  rules?: Record<string, unknown>;
  buildings?: Record<string, Record<string, unknown>>;
  troops?: Record<string, Record<string, unknown>>;
  cards?: Record<string, Record<string, unknown>>;
  map?: Record<string, unknown>;
}

export function applyOverrides(o: DataOverrides) {
  deepMerge(RULES, o.rules);
  deepMerge(MAP, o.map);
  for (const [table, rec] of [[BUILDINGS, o.buildings], [TROOPS, o.troops], [CARDS, o.cards]] as const) {
    for (const [id, patch] of Object.entries(rec ?? {})) {
      if (!(table as any)[id]) throw new Error(`Override for unknown id "${id}"`);
      deepMerge((table as any)[id], patch);
    }
  }
}
