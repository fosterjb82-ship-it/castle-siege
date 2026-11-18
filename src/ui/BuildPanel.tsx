import { useMemo, useState } from 'react';
import {
  BUILDINGS, CHARACTER_DEFS, MAP, RULES, TROOPS, buildCost, draftAvailable, draftInfo, legalBuildsForSlot, recruitCost,
  slotContents, slotLabel, trainCost, tryAction, util,
} from '../engine';
import type { Action, Actor, CharacterId, GameState, Lane, SlotRef } from '../engine';
import { LANES } from '../engine';
import { CardView } from './CardView';
import { actorName, playerOf, resText } from './uiutil';

const RES_D = ['stone', 'wood', 'gold'];
const RES_W = ['supplies', 'timber', 'gold'];

export function LaneSelect({ value, onChange, lanes = LANES }: { value: Lane; onChange: (l: Lane) => void; lanes?: Lane[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as Lane)}>
      {lanes.map((l) => <option key={l} value={l}>{MAP.laneNames[l]}</option>)}
    </select>
  );
}

function ResSelect({ value, onChange, list }: { value: string; onChange: (r: string) => void; list: string[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {list.map((r) => <option key={r} value={r}>{r}</option>)}
    </select>
  );
}

export interface PanelProps {
  s: GameState;
  dispatch: (a: Action) => string | null;
  selected: SlotRef | null;
  setSelected: (s: SlotRef | null) => void;
}

export function ChooseCharacterPanel({ s, dispatch }: PanelProps) {
  const left = (['lord', 'architect', 'quartermaster', 'knight'] as CharacterId[]).filter((c) => !s.turn.done.includes(c));
  return (
    <div className="col">
      <h2>Build round {s.round}{s.finalBuildRound ? ' — final round' : ''}</h2>
      <p className="muted">The team chooses who acts next. Each character takes {RULES.defenderActionsPerTurn} actions{s.finalBuildRound ? '' : '; the Warlord then takes 1 action'}.</p>
      {left.map((c) => (
        <button key={c} onClick={() => dispatch({ type: 'chooseCharacter', character: c })} style={{ textAlign: 'left' }}>
          <b>{CHARACTER_DEFS[c].name}</b> <span className="muted">({playerOf(s, c)})</span>
          <div className="muted" style={{ fontSize: 12 }}>{CHARACTER_DEFS[c].abilityText} {CHARACTER_DEFS[c].passiveText !== '—' ? CHARACTER_DEFS[c].passiveText : ''}</div>
        </button>
      ))}
      <div className="muted">Done: {s.turn.done.map((c) => CHARACTER_DEFS[c].name).join(', ') || '—'}</div>
    </div>
  );
}

export function HornsPanel({ dispatch, s }: PanelProps) {
  return (
    <div className="col">
      <h2>End of round {s.round}</h2>
      <p>Sound the War Horns? Defenders will get one final build round, then the siege begins. (Automatic after round {RULES.warHorns.latestRound}.)</p>
      <div className="row">
        <button className="danger" onClick={() => dispatch({ type: 'soundHorns' })}>📯 Sound the War Horns</button>
        <button onClick={() => dispatch({ type: 'holdHorns' })}>Wait another round</button>
      </div>
    </div>
  );
}

export function DraftPanel({ s, dispatch }: PanelProps) {
  const p = s.pendingDraft!;
  return (
    <div className="col">
      <h2>{actorName(p.actor)} drafts</h2>
      <p className="muted">Keep one card for your siege deck. The other two go to the bottom of the {p.deck} deck.</p>
      <div className="hand">
        {p.cards.map((c, i) => <CardView key={i} id={c} onClick={() => dispatch({ type: 'draftPick', actor: p.actor, index: i })} label="Keep" />)}
      </div>
    </div>
  );
}

function SlotBuilds({ s, actor, slot, dispatch }: { s: GameState; actor: Actor; slot: SlotRef; dispatch: PanelProps['dispatch'] }) {
  const side = util.sideOf(actor);
  const builds = legalBuildsForSlot(s, actor, slot);
  const cur = slotContents(s, slot);
  const wrongSide = (side === 'warlord') !== (slot.kind === 'approach');
  // Show unaffordable options too, greyed out.
  const all = Object.values(BUILDINGS).filter((b) => b.side === side && b.slot === slot.kind && b.buildable !== false
    && (b.upgradeOf ? cur === b.upgradeOf : !cur));
  return (
    <div className="section">
      <h3>{slotLabel(slot)}</h3>
      {cur && <div className="muted">Current: {BUILDINGS[cur]?.name ?? cur} — {BUILDINGS[cur]?.text}</div>}
      {wrongSide && <div className="muted">Only the {side === 'warlord' ? 'defenders' : 'Warlord'} can build here.</div>}
      {!wrongSide && !all.length && <div className="muted">Nothing can be built here.</div>}
      {!wrongSide && all.map((b) => {
        const legal = builds.filter((a) => a.type === 'build' && a.buildingId === b.id);
        const cost = buildCost(actor, b.id);
        if (b.chooseTroopType) {
          return (
            <div key={b.id} className="col" style={{ marginBottom: 6 }}>
              <div><b>{b.name}</b> <span className="muted">({resText(cost)})</span> — {b.text}</div>
              <div className="row">
                {Object.values(TROOPS).filter((t) => t.side === 'defender').map((t) => {
                  const a = legal.find((x) => x.type === 'build' && x.troopType === t.id);
                  return <button key={t.id} className="small" disabled={!a} onClick={() => a && dispatch(a)}>{t.name}</button>;
                })}
              </div>
            </div>
          );
        }
        const err = legal.length ? null : tryErr(s, { type: 'build', actor, slot, buildingId: b.id });
        return (
          <div key={b.id} className="row" style={{ marginBottom: 6 }}>
            <button disabled={!legal.length} onClick={() => legal[0] && dispatch(legal[0])} title={err ?? b.text}>
              {b.upgradeOf ? 'Upgrade: ' : 'Build '}{b.name} ({resText(cost)})
            </button>
            <span className="muted" style={{ fontSize: 12 }}>{b.text}</span>
          </div>
        );
      })}
    </div>
  );
}

function tryErr(s: GameState, a: Action): string | null {
  const r = tryAction(s, a);
  return r.ok ? null : r.error;
}

export function TurnPanel({ s, dispatch, selected, setSelected }: PanelProps) {
  const actor: Actor = s.step === 'warlordTurn' ? 'warlord' : s.turn.current!;
  const side = util.sideOf(actor);
  const isW = actor === 'warlord';
  const [troop, setTroop] = useState(isW ? 'footmen' : 'militia');
  const [lane, setLane] = useState<Lane>('N');
  const [to, setTo] = useState<Lane>('E');
  const [count, setCount] = useState(1);
  const [knightToo, setKnightToo] = useState(false);
  const [give, setGive] = useState(isW ? 'supplies' : 'stone');
  const [get, setGet] = useState('gold');
  const [amount, setAmount] = useState(3);
  const [res, setRes] = useState('gold');
  const [msg, setMsg] = useState<string | null>(null);
  const run = (a: Action) => setMsg(dispatch(a));
  const resList = isW ? RES_W : RES_D;
  const adj = MAP.adjacency[lane];
  const toLane = adj.includes(to) ? to : adj[0];
  const troopsHere = isW ? util.troopsAt(s, 'warlord', lane, 'approach') : util.defendersIn(s, lane);
  const decks = Object.keys((RULES.draftCosts as any)[side]);
  const def = isW ? null : CHARACTER_DEFS[actor as CharacterId];
  const used = !isW && s.turn.abilityUsed[actor as CharacterId];

  const trainList = Object.values(TROOPS).filter((t) => t.side === side);
  const tcost = isW ? recruitCost(s, troop, lane) : trainCost(actor, troop);

  return (
    <div className="col">
      <h2>{actorName(actor)} <span className="muted" style={{ fontWeight: 400 }}>({playerOf(s, actor)})</span></h2>
      <div className="muted">
        {isW ? `${s.turn.warlordActionsLeft} action left` : `${s.turn.actionsLeft} action(s) left`} · Round {s.round}
      </div>
      {def && <div style={{ fontSize: 12 }}><b>Ability:</b> {def.abilityText}<br /><b>Passive:</b> {def.passiveText}</div>}
      {isW && <div style={{ fontSize: 12 }}>Supply Rating {util.supplyRating(s)} · Troops {util.warlordTroopCount(s)}{util.overSupplied(s) ? ' — OVER SUPPLY: all troops −1 Strength' : ''}</div>}

      <div className="section">
        <h3>Build / Upgrade</h3>
        {selected ? <SlotBuilds s={s} actor={actor} slot={selected} dispatch={(a) => { const e = dispatch(a); setMsg(e); if (!e) setSelected(null); return e; }} />
          : <div className="muted">Click a slot on the board ({isW ? 'outer approaches' : 'baileys, towers, walls, gates or moats'}).</div>}
      </div>

      <div className="section">
        <h3>Draft</h3>
        <div className="row">
          {decks.map((d) => {
            const av = draftAvailable(s, side, d);
            return (
              <button key={d} disabled={!av.ok} title={av.reason} onClick={() => run({ type: 'draft', actor, deck: d })}>
                {d} ({resText(draftInfo(side, d).cost)}) · {s.draftDecks[side][d]?.length ?? 0}
              </button>
            );
          })}
        </div>
      </div>

      <div className="section">
        <h3>{isW ? 'Recruit' : 'Train'}</h3>
        {!isW && <div className="muted" style={{ fontSize: 12 }}>Garrison {util.defenderTroopCount(s)}/{util.garrisonCapacity(s)}{util.garrisonRoom(s) === 0 ? ' — full: build a Barracks or Garrison Hall for more room' : ''}</div>}
        <div className="row">
          <select value={troop} onChange={(e) => setTroop(e.target.value)}>
            {trainList.map((t) => <option key={t.id} value={t.id}>{t.name} (Str {t.strength}, HP {t.hp})</option>)}
          </select>
          in <LaneSelect value={lane} onChange={setLane} />
          {isW && (
            <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {Array.from({ length: RULES.recruitPerAction ?? 1 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>×{n}</option>)}
            </select>
          )}
          <button onClick={() => run(isW ? { type: 'recruit', troop, lane, count } : { type: 'train', actor: actor as CharacterId, troop, lane })}>
            {isW ? 'Recruit' : 'Train'} ({resText(Object.fromEntries(Object.entries(tcost).map(([k, v]) => [k, v * (isW ? count : 1)])))})
          </button>
        </div>
      </div>

      <div className="section">
        <h3>{isW ? 'March' : 'Move'}</h3>
        <div className="row">
          from <LaneSelect value={lane} onChange={setLane} /> to <LaneSelect value={toLane} onChange={setTo} lanes={adj} />
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {Array.from({ length: Math.max(1, isW ? Math.min(RULES.marchMaxTroops, troopsHere.length) : troopsHere.length) }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} troop(s)</option>)}
          </select>
          {!isW && s.knight.lane === lane && <label><input type="checkbox" checked={knightToo} onChange={(e) => setKnightToo(e.target.checked)} /> + Knight</label>}
          <button onClick={() => run(isW
            ? { type: 'march', from: lane, to: toLane, troopUids: troopsHere.slice(0, count).map((t) => t.uid) }
            : { type: 'move', actor: actor as CharacterId, from: lane, to: toLane, troopUids: troopsHere.slice(0, count).map((t) => t.uid), includeKnight: knightToo })}>
            {isW ? `March (${resText(RULES.marchCost)})` : 'Move'}
          </button>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>{troopsHere.length} troop(s) in the {MAP.laneNames[lane]} {isW ? 'approach' : 'bailey'}.</div>
      </div>

      <div className="section">
        <h3>Trade {RULES.tradeRate}:1</h3>
        <div className="row">
          give {RULES.tradeRate} <ResSelect value={give} onChange={setGive} list={resList} /> for 1 <ResSelect value={get} onChange={setGet} list={resList} />
          <button onClick={() => run({ type: 'trade', actor, give, get })}>Trade</button>
        </div>
      </div>

      {actor === 'lord' && (
        <div className="section">
          <h3>Decree {used && <span className="muted">(used)</span>}</h3>
          <div className="row">gain {RULES.decreeAmount} <ResSelect value={res} onChange={setRes} list={RES_D} /><button disabled={used} onClick={() => run({ type: 'decree', actor: 'lord', resource: res })}>Decree</button></div>
        </div>
      )}
      {actor === 'quartermaster' && (
        <div className="section">
          <h3>Requisition {used && <span className="muted">(used)</span>}</h3>
          <div className="row">
            <select value={amount} onChange={(e) => setAmount(Number(e.target.value))}>{[1, 2, 3].map((n) => <option key={n}>{n}</option>)}</select>
            <ResSelect value={give} onChange={setGive} list={RES_D} /> → <ResSelect value={get} onChange={setGet} list={RES_D} />
            <button disabled={used} onClick={() => run({ type: 'requisition', actor: 'quartermaster', give, get, amount })}>Requisition 1:1</button>
          </div>
        </div>
      )}
      {actor === 'knight' && (
        <div className="section">
          <h3>Raid {used && <span className="muted">(used)</span>}</h3>
          <div className="row">
            through the <LaneSelect value={lane} onChange={setLane} /> gate with
            <select value={Math.min(count, RULES.raid.maxTroops)} onChange={(e) => setCount(Number(e.target.value))}>
              {Array.from({ length: RULES.raid.maxTroops + 1 }, (_, i) => i).map((n) => <option key={n} value={n}>{n} troop(s)</option>)}
            </select>
            <button disabled={used} onClick={() => run({ type: 'raid', actor: 'knight', lane, troopUids: util.defendersIn(s, lane).slice(0, Math.min(count, RULES.raid.maxTroops)).map((t) => t.uid) })}>Raid</button>
          </div>
          <RaidOdds s={s} lane={lane} n={Math.min(count, RULES.raid.maxTroops)} />
        </div>
      )}
      {isW && (
        <div className="section">
          <h3>Harass ({resText(RULES.harassCost)})</h3>
          <div className="row">the <LaneSelect value={lane} onChange={setLane} /> bailey (needs {RULES.harassMinTroops}+ troops in the approach)
            <button onClick={() => run({ type: 'harass', lane })}>Harass</button></div>
        </div>
      )}

      <div className="err">{msg}</div>
      <button className="primary" onClick={() => run({ type: 'endTurn', actor })}>End turn</button>
    </div>
  );
}

function RaidOdds({ s, lane, n }: { s: GameState; lane: Lane; n: number }) {
  const odds = useMemo(() => {
    const party = util.defendersIn(s, lane).slice(0, n);
    const mine = RULES.raid.knightStrength + util.sumStrength(s, party);
    const guards = s.approaches[lane].filter(Boolean).length * (RULES.raid.guardPerBuilding ?? 0);
    const theirs = util.sumStrength(s, util.troopsAt(s, 'warlord', lane, 'approach')) + guards;
    return { mine, theirs };
  }, [s, lane, n]);
  return <div className="muted" style={{ fontSize: 12 }}>Raid Strength {odds.mine} vs {odds.theirs} (troops + camp guards). Win needs higher.</div>;
}
