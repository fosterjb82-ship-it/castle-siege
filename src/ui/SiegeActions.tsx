import { useState } from 'react';
import { MAP, RULES, card, util } from '../engine';
import type { Action, Actor, CharacterId, GameState, Lane } from '../engine';
import { LaneSelect } from './BuildPanel';
import { resText } from './uiutil';

/** Repair (any phase with turns) plus the Siege (blockade) phase actions for both sides. */
export function SiegeActions({ s, actor, run }: { s: GameState; actor: Actor; run: (a: Action) => void }) {
  const [lane, setLane] = useState<Lane>('N');
  const [structure, setStructure] = useState<'wall' | 'gate' | 'tower'>('gate');
  const [engineCard, setEngineCard] = useState('');
  const [aim, setAim] = useState<'wall' | 'tower' | 'gate'>('tower');
  const [to, setTo] = useState<Lane>('E');
  const [count, setCount] = useState(RULES.stratagems.nightMarchMax);
  const blockade = s.phase === 'blockade';

  if (actor !== 'warlord') {
    const c = actor as CharacterId;
    const rep = RULES.repair.amount + (c === 'architect' ? RULES.repair.architectBonus : 0);
    return (
      <>
        <div className="section">
          <h3>Repair ({resText(RULES.repair.cost)}, +{rep} HP)</h3>
          <div className="row">
            the <LaneSelect value={lane} onChange={setLane} />
            <select value={structure} onChange={(e) => setStructure(e.target.value as any)}>
              <option value="gate">gate</option><option value="wall">wall</option><option value="tower">tower (covering that lane)</option>
            </select>
            <button onClick={() => run({ type: 'repair', actor: c, lane, structure })}>Repair</button>
          </div>
        </div>
        {blockade && (
          <div className="section">
            <h3>Siege actions</h3>
            <div className="row">
              <LaneSelect value={lane} onChange={setLane} />
              <button onClick={() => run({ type: 'scout', actor: c, lane })} title="Learn the true number of Warlord troops in that approach">🔍 Scout approach</button>
              <button disabled={(s.population ?? 0) <= 0} onClick={() => run({ type: 'levy', actor: c, lane })}
                title="Turn townsfolk into Militia in that bailey, beyond the garrison cap">Levy {RULES.levy.count} Militia ({s.population} townsfolk)</button>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              What you see in the approaches may be a trick: the Warlord can march by night or light false campfires. Scouting reveals the truth.
            </div>
          </div>
        )}
      </>
    );
  }

  if (!blockade) return null;
  const deck = s.siegeDecks.warlord;
  const engines = [...new Set(deck.filter((id) => card(id).effects.some((e) => e.type === 'engine')))];
  const strats = [...new Set(deck.filter((id) => card(id).effects.some((e) => e.type === 'stratagem')))];
  const eng = engineCard && engines.includes(engineCard) ? engineCard : engines[0];
  const engFx = eng ? card(eng).effects.find((e) => e.type === 'engine')! : null;
  const adj = MAP.adjacency[lane];
  const toLane = adj.includes(to) ? to : adj[0];
  return (
    <>
      <div className="section">
        <h3>Emplace engine (from your siege deck)</h3>
        {engines.length ? (
          <div className="row">
            <select value={eng} onChange={(e) => setEngineCard(e.target.value)}>
              {engines.map((id) => <option key={id} value={id}>{card(id).name} ×{deck.filter((x) => x === id).length}</option>)}
            </select>
            in the <LaneSelect value={lane} onChange={setLane} /> approach
            {engFx?.canHitTowers && (
              <select value={aim === 'gate' ? 'tower' : aim} onChange={(e) => setAim(e.target.value as any)}>
                <option value="tower">aim at towers</option><option value="wall">aim at the wall</option>
              </select>
            )}
            <button onClick={() => run({ type: 'emplace', cardId: eng!, lane, ...(engFx?.canHitTowers ? { target: aim === 'gate' ? 'tower' : aim } : {}) })}>Emplace</button>
          </div>
        ) : <div className="muted">No engine cards in your siege deck.</div>}
        <div className="muted" style={{ fontSize: 12 }}>Catapults and Trebuchets bombard every Siege round. Rams, Ladders and Siege Towers wait for the Assault.</div>
      </div>
      <div className="section">
        <h3>Stratagems 🌙</h3>
        {!strats.length && <div className="muted">No stratagem cards in your siege deck (draft Night March or Campfires from the Tactics deck).</div>}
        {strats.includes('night_march') && (
          <div className="row">
            <b>Night March:</b> up to
            <input type="number" min={1} max={RULES.stratagems.nightMarchMax} style={{ width: 46 }} value={count} onChange={(e) => setCount(Number(e.target.value))} />
            from <LaneSelect value={lane} onChange={setLane} /> to <LaneSelect value={toLane} onChange={setTo} lanes={adj} />
            <button onClick={() => run({ type: 'stratagem', cardId: 'night_march', lane, to: toLane, count })}>March by night</button>
          </div>
        )}
        {strats.includes('campfires') && (
          <div className="row">
            <b>Campfires:</b> in the <LaneSelect value={lane} onChange={setLane} /> approach
            <button onClick={() => run({ type: 'stratagem', cardId: 'campfires', lane })}>Light false fires (+{RULES.stratagems.campfiresPhantom})</button>
          </div>
        )}
        <div className="muted" style={{ fontSize: 12 }}>
          What the defenders believe: {(['N', 'E', 'S', 'W'] as Lane[]).map((l) => `${l} ${util.apparentWarlordCount(s, l)}${util.apparentWarlordCount(s, l) !== util.troopsAt(s, 'warlord', l, 'approach').length ? ` (really ${util.troopsAt(s, 'warlord', l, 'approach').length})` : ''}`).join(' · ')}
        </div>
      </div>
    </>
  );
}

export function AssaultDecisionPanel({ s, dispatch }: { s: GameState; dispatch: (a: Action) => string | null }) {
  const left = s.relief?.roundsLeft ?? 0;
  return (
    <div className="col">
      <h2>End of Siege round {s.blockade?.round}</h2>
      <p>The relief army is <b>{left} rounds away</b>. Storm the walls now, with {left} Assault rounds to break in? Or tighten the blockade for another round: more hunger and bombardment, but one round less to attack.</p>
      <p className="muted">The Assault is forced when {RULES.relief.forceAssaultAt} rounds remain. Defenders are {s.hungry ? 'HUNGRY' : 'fed'} · Food left: {s.stock.defender.food ?? 0}.</p>
      <div className="row">
        <button className="danger" onClick={() => dispatch({ type: 'orderAssault' })}>⚔ Order the Assault</button>
        <button onClick={() => dispatch({ type: 'holdSiege' })}>Tighten the blockade</button>
      </div>
    </div>
  );
}
