import React, { useEffect, useState } from 'react';
import {
  CHARACTER_DEFS, MAP, RESOLVE_STEPS, RULES, canUseFallback, card, cardPlayError, cardsRequired, fallbackCard,
  knightAvailable, util,
} from '../engine';
import type { AbilityPlan, Action, Actor, CardPlanInput, CharacterId, GameState, Lane } from '../engine';
import { LANES } from '../engine';
import { LaneSelect } from './BuildPanel';
import { CardView } from './CardView';
import { SPEED_ICON, actorName, playerOf } from './uiutil';

export function SetupPanel({ s, actor, dispatch }: { s: GameState; actor: Actor; dispatch: (a: Action) => string | null }) {
  const [lanes, setLanes] = useState<Lane[]>(actor === 'warlord' ? ['S', 'S', 'E'] : ['N', 'E', 'S']);
  const [extra, setExtra] = useState<Lane>(actor === 'warlord' ? 'S' : 'N');
  const [msg, setMsg] = useState<string | null>(null);
  const isW = actor === 'warlord';
  return (
    <div className="col">
      <h2>Setup — {isW ? 'Warlord' : 'Defenders'}</h2>
      <p className="muted">Placement is hidden and simultaneous. Everything is revealed once both sides have placed.</p>
      {isW && <div className="row">Main Siege Camp in the <LaneSelect value={extra} onChange={setExtra} /> approach</div>}
      {lanes.map((l, i) => (
        <div key={i} className="row">{isW ? 'Footmen' : 'Militia'} {i + 1}: <LaneSelect value={l} onChange={(v) => setLanes(lanes.map((x, j) => (j === i ? v : x)))} /> {isW ? 'approach' : 'bailey'}</div>
      ))}
      {!isW && <div className="row">The Knight starts in the <LaneSelect value={extra} onChange={setExtra} /> bailey</div>}
      <div className="err">{msg}</div>
      <button className="primary" onClick={() => setMsg(dispatch(isW
        ? { type: 'setupWarlord', camp: extra, footmen: lanes }
        : { type: 'setupDefenders', militia: lanes, knight: extra }))}>Confirm placement</button>
    </div>
  );
}

interface DraftPlay extends CardPlanInput { handIndex: number | null }

export function SiegePlanPanel({ s, actor, dispatch }: { s: GameState; actor: Actor; dispatch: (a: Action) => string | null }) {
  const need = cardsRequired(actor);
  const hand = s.hands[actor];
  const [plays, setPlays] = useState<DraftPlay[]>([]);
  const [pick, setPick] = useState<number | 'fallback' | null>(null);
  const [lane, setLane] = useState<Lane>('N');
  const [target, setTarget] = useState<'gate' | 'wall' | 'tower'>('gate');
  const [spy, setSpy] = useState<CharacterId>('lord');
  const [ability, setAbility] = useState<AbilityPlan>({});
  const [moves, setMoves] = useState<{ from: Lane; to: Lane; n: number }[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { setPlays([]); setPick(null); setAbility({}); setMoves([]); setMsg(null); }, [actor, s.siegeRound]);

  const isW = actor === 'warlord';
  const usedIdx = new Set(plays.map((p) => p.handIndex));
  const pickId = pick === 'fallback' ? fallbackCard(actor) : pick !== null ? hand[pick] : null;
  const pc = pickId ? card(pickId) : null;
  const laneErr = pc ? cardPlayError(s, actor, pc, lane) : null;
  const towerCapable = !!pc?.effects.some((e) => e.type === 'engine' && e.canHitTowers);

  const addPlay = () => {
    if (!pickId || laneErr) return;
    const p: DraftPlay = { cardId: pickId, lane, handIndex: pick === 'fallback' ? null : (pick as number) };
    if (pick === 'fallback') p.fallback = true;
    if (pc!.target === 'any') p.target = target === 'tower' ? 'gate' : target;
    if (towerCapable) p.target = target === 'gate' ? (pc!.effects.find((e) => e.type === 'engine')!.target) : target;
    if (pc!.target === 'any' && pc!.effects.some((e) => e.type === 'repair')) p.target = target === 'tower' ? 'wall' : target;
    if (pc!.effects.some((e) => e.type === 'peekHand' && e.target === 'defender')) p.spyTarget = spy;
    setPlays([...plays, p]);
    setPick(null);
  };

  const submit = () => {
    const mv = moves.filter((m) => m.n > 0).map((m) => {
      if (isW) {
        return { from: m.from, to: m.from, troopUids: util.troopsAt(s, 'warlord', m.from, 'approach').slice(0, m.n).map((t) => t.uid) };
      }
      return { from: m.from, to: m.to, troopUids: util.defendersIn(s, m.from).slice(0, m.n).map((t) => t.uid) };
    });
    const err = dispatch({ type: 'planSiege', actor, cards: plays.map(({ handIndex, ...c }) => c), moves: mv, ability });
    setMsg(err);
  };

  const breached = LANES.filter((l) => s.breached[l]);
  const intel = s.intel.filter((i) => i.side === util.sideOf(actor));

  return (
    <div className="col">
      <h2>Siege round {s.siegeRound}/{RULES.siegeRounds}: {actorName(actor)} plans</h2>
      <div className="muted">{playerOf(s, actor)} · play {need} card{need > 1 ? 's' : ''} face down onto lanes.</div>
      {!isW && <div style={{ fontSize: 12 }}><b>Siege ability:</b> {CHARACTER_DEFS[actor as CharacterId].siegeText}</div>}
      <h4>Hand ({hand.length}) · deck {s.siegeDecks[actor].length}</h4>
      <div className="hand">
        {hand.map((c, i) => (
          <CardView key={i} id={c} used={usedIdx.has(i)} selected={pick === i} onClick={usedIdx.has(i) || plays.length >= need ? undefined : () => setPick(i)} />
        ))}
        {canUseFallback(s, actor) && plays.length < need && (
          <CardView id={fallbackCard(actor)} selected={pick === 'fallback'} onClick={() => setPick('fallback')} label="Basic (unlimited)" />
        )}
      </div>
      {pc && (
        <div className="row section">
          <b>{pc.name}</b> → <LaneSelect value={lane} onChange={setLane} />
          {(pc.target === 'any' || towerCapable) && (
            <select value={target} onChange={(e) => setTarget(e.target.value as any)}>
              {towerCapable ? <><option value="gate">default ({pc.effects.find((e) => e.type === 'engine')!.target})</option><option value="wall">wall</option><option value="tower">tower</option></> : <><option value="gate">gate</option><option value="wall">wall</option></>}
            </select>
          )}
          {pc.effects.some((e) => e.type === 'peekHand' && e.target === 'defender') && (
            <select value={spy} onChange={(e) => setSpy(e.target.value as CharacterId)}>
              {(['lord', 'architect', 'quartermaster', 'knight'] as CharacterId[]).map((c) => <option key={c} value={c}>spy on {CHARACTER_DEFS[c].name}</option>)}
            </select>
          )}
          <button disabled={!!laneErr} onClick={addPlay}>Place face down</button>
          {laneErr && <span className="err">{laneErr}</span>}
        </div>
      )}
      <div className="section">
        <h4>Planned ({plays.length}/{need})</h4>
        <ul className="plan-list">
          {plays.map((p, i) => (
            <li key={i}>{SPEED_ICON[card(p.cardId).speed]} {card(p.cardId).name} → {MAP.laneNames[p.lane]}{p.target ? ` (${p.target})` : ''}
              {' '}<button className="small" onClick={() => setPlays(plays.filter((_, j) => j !== i))}>✕</button></li>
          ))}
        </ul>
      </div>

      {!isW && <AbilityEditor s={s} actor={actor as CharacterId} ability={ability} setAbility={setAbility} />}

      <div className="section">
        <h4>{isW ? 'Pour troops into breached baileys' : 'Team moves (hidden, revealed together)'}</h4>
        {isW && !breached.length && <div className="muted">No lane is breached yet.</div>}
        {moves.map((m, i) => (
          <div key={i} className="row">
            <LaneSelect value={m.from} lanes={isW ? breached : LANES} onChange={(v) => setMoves(moves.map((x, j) => j === i ? { ...x, from: v, to: MAP.adjacency[v][0] } : x))} />
            {!isW && <>→ <LaneSelect value={m.to} lanes={MAP.adjacency[m.from]} onChange={(v) => setMoves(moves.map((x, j) => j === i ? { ...x, to: v } : x))} /></>}
            <input type="number" min={0} style={{ width: 54 }} value={m.n}
              max={isW ? util.troopsAt(s, 'warlord', m.from, 'approach').length : util.defendersIn(s, m.from).length}
              onChange={(e) => setMoves(moves.map((x, j) => j === i ? { ...x, n: Number(e.target.value) } : x))} /> troops
            <button className="small" onClick={() => setMoves(moves.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        {(!isW || breached.length > 0) && (
          <button className="small" onClick={() => setMoves([...moves, isW ? { from: breached[0], to: breached[0], n: util.troopsAt(s, 'warlord', breached[0], 'approach').length } : { from: 'N', to: 'E', n: 1 }])}>+ add move</button>
        )}
      </div>

      {intel.length > 0 && (
        <div className="section">
          <h4>Intelligence</h4>
          {intel.slice(-5).map((i, k) => <div key={k} style={{ fontSize: 12 }}>Round {i.round}: {i.text}</div>)}
        </div>
      )}
      <div className="err">{msg}</div>
      <button className="primary" disabled={plays.length !== need} onClick={submit}>Lock in plan</button>
    </div>
  );
}

function AbilityEditor({ s, actor, ability, setAbility }: { s: GameState; actor: CharacterId; ability: AbilityPlan; setAbility: (a: AbilityPlan) => void }) {
  const opt = (label: string, el: React.ReactNode, on: boolean, toggle: (v: boolean) => void) => (
    <div className="row"><label><input type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} /> {label}</label>{on && el}</div>
  );
  return (
    <div className="section">
      <h4>Siege ability</h4>
      {actor === 'lord' && opt('Rally (+2 Defense next round)',
        <LaneSelect value={ability.lordRally ?? 'N'} onChange={(l) => setAbility({ lordRally: l })} />,
        !!ability.lordRally, (v) => setAbility(v ? { lordRally: 'N' } : {}))}
      {actor === 'architect' && opt('Repair 2 HP',
        <>
          <LaneSelect value={ability.architectRepair?.lane ?? 'N'} onChange={(l) => setAbility({ architectRepair: { lane: l, structure: ability.architectRepair?.structure ?? 'gate' } })} />
          <select value={ability.architectRepair?.structure ?? 'gate'} onChange={(e) => setAbility({ architectRepair: { lane: ability.architectRepair?.lane ?? 'N', structure: e.target.value as any } })}>
            <option value="gate">gate</option><option value="wall">wall</option>
          </select>
        </>,
        !!ability.architectRepair, (v) => setAbility(v ? { architectRepair: { lane: 'N', structure: 'gate' } } : {}))}
      {actor === 'quartermaster' && opt('Resupply (+1 ranged damage)',
        <LaneSelect value={ability.quartermasterResupply ?? 'N'} onChange={(l) => setAbility({ quartermasterResupply: l })} />,
        !!ability.quartermasterResupply, (v) => setAbility(v ? { quartermasterResupply: 'N' } : {}))}
      {actor === 'knight' && (knightAvailable(s)
        ? opt(`Ride to a bailey (now: ${s.knight.lane ? MAP.laneNames[s.knight.lane] : 'Keep'})`,
          <LaneSelect value={ability.knightMove ?? 'N'} onChange={(l) => setAbility({ knightMove: l })} />,
          !!ability.knightMove, (v) => setAbility(v ? { knightMove: 'N' } : {}))
        : <div className="muted">The Knight is recovering.</div>)}
    </div>
  );
}

export function SiegeResolvePanel({ s, dispatch, auto, setAuto }: { s: GameState; dispatch: (a: Action) => string | null; auto: boolean; setAuto: (v: boolean) => void }) {
  const sg = s.siege!;
  const next = RESOLVE_STEPS[sg.nextStep];
  const label: Record<string, string> = { reveal: 'Reveal all cards & moves', scout: '1. Scouting & tricks', ranged: '2. Ranged', engine: '3. Siege engines', melee: '4. Melee clash', recovery: '5. Recovery' };
  const resolveRound = () => {
    // dispatch reads the latest state, so this steps through the remaining resolution steps of this round.
    for (let i = sg.nextStep; i < RESOLVE_STEPS.length; i++) if (dispatch({ type: 'advanceSiege' })) break;
  };
  return (
    <div className="col">
      <h2>Siege round {s.siegeRound}: resolution</h2>
      <div className="col">
        {RESOLVE_STEPS.map((st, i) => (
          <div key={st} style={{ opacity: i < sg.nextStep ? 0.5 : 1, fontWeight: i === sg.nextStep ? 700 : 400 }}>
            {i < sg.nextStep ? '✓' : i === sg.nextStep ? '▶' : '·'} {label[st]}
          </div>
        ))}
      </div>
      <div className="row">
        <button className="primary" onClick={() => dispatch({ type: 'advanceSiege' })}>Next: {label[next]}</button>
        <button onClick={resolveRound}>Resolve whole round</button>
        <label><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-play</label>
      </div>
      {sg.nextStep > 0 && (
        <div className="section">
          <h4>Revealed plays</h4>
          {LANES.map((l) => {
            const lp = sg.plays.filter((p) => p.lane === l);
            if (!lp.length) return null;
            return (
              <div key={l} style={{ fontSize: 12, marginBottom: 4 }}>
                <b>{MAP.laneNames[l]}:</b>{' '}
                {lp.map((p, i) => <span key={i} className={`pill ${p.actor === 'warlord' ? 'war' : 'def'}`} title={card(p.cardId).text} style={{ marginRight: 3 }}>{SPEED_ICON[card(p.cardId).speed]} {card(p.cardId).name}</span>)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
