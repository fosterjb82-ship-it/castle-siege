import React, { useEffect, useRef, useState } from 'react';
import { CHARACTER_DEFS, card, util } from '../engine';
import type { Action, Actor, GameState, Resources, Side } from '../engine';
import { CardView } from './CardView';
import { RES_ICON, Viewer, canSee, download, logText } from './uiutil';

function ResTable({ stock, income }: { stock: Resources; income: Resources }) {
  return (
    <div className="res">
      {Object.keys(stock).map((k) => (
        <React.Fragment key={k}>
          <span>{RES_ICON[k]} {k}</span>
          <span className="v">{stock[k]}</span>
          <span className="inc">+{income[k] ?? 0}</span>
        </React.Fragment>
      ))}
    </div>
  );
}

export function StockPanels({ s, viewer }: { s: GameState; viewer: Viewer }) {
  const seeDeck = (a: Actor) => viewer === 'all' || util.sideOf(a) === viewer;
  return (
    <>
      <div className="panel">
        <h3 className="def">Defenders' stockpile</h3>
        <ResTable stock={s.stock.defender} income={util.incomeFor(s, 'defender')} />
        <div className="section kv" style={{ fontSize: 12 }}>
          <span>Garrison</span><span>{util.defenderTroopCount(s)} / {util.garrisonCapacity(s)} troops (Str {util.totalDefenderStrength(s)})</span>
          <span>Food upkeep</span><span title="Eaten at the start of each siege round: 1 Food per 3 troops. No Food comes in during the siege.">{util.foodUpkeep(s)}/siege round{s.siege?.hungry ? ' — HUNGRY (−1 Str)' : ''}</span>
          <span>Population</span><span title="Townsfolk who can be levied as Militia beyond the cap (Militia Levy)">{s.population ?? 0} townsfolk</span>
          <span>Knight</span><span>{s.knight.downUntilSiegeRound !== null ? 'recovering' : `HP ${s.knight.hp} · ${s.knight.lane ? `${s.knight.lane} bailey` : 'Keep'}`}</span>
        </div>
        <div className="section" style={{ fontSize: 12 }}>
          <h4>Siege decks</h4>
          {(['lord', 'architect', 'quartermaster', 'knight'] as const).map((c) => (
            <div key={c} className="stat"><span>{CHARACTER_DEFS[c].name}</span>
              <span>{s.phase === 'siege' ? `hand ${seeDeck(c) ? s.hands[c].length : '?'} · ` : ''}deck {s.siegeDecks[c].length}</span></div>
          ))}
        </div>
      </div>
      <div className="panel">
        <h3 className="war">Warlord</h3>
        <ResTable stock={s.stock.warlord} income={util.incomeFor(s, 'warlord')} />
        <div className="section kv" style={{ fontSize: 12 }}>
          <span>Supply Rating</span><span>{util.warlordTroopCount(s)} / {util.supplyRating(s)} {util.overSupplied(s) && <b className="war">over (−1 Str)</b>}</span>
          <span>Army Str</span><span>{util.totalWarlordStrength(s)}</span>
          <span>Engines</span><span>{s.engines.length}</span>
          <span>Siege deck</span><span>{s.siegeDecks.warlord.length}{s.phase === 'siege' ? ` · hand ${s.hands.warlord.length}` : ''}</span>
        </div>
        {viewer !== 'defender' && <DeckList ids={[...s.hands.warlord, ...s.siegeDecks.warlord]} title="Warlord cards (hidden from defenders)" />}
      </div>
    </>
  );
}

function DeckList({ ids, title }: { ids: string[]; title: string }) {
  const counts: Record<string, number> = {};
  for (const i of ids) counts[i] = (counts[i] ?? 0) + 1;
  return (
    <div className="section" style={{ fontSize: 12 }}>
      <h4>{title}</h4>
      {Object.entries(counts).map(([id, n]) => <div key={id}>{n}× {card(id).name}</div>)}
    </div>
  );
}

export function DeckPeek({ s, actor }: { s: GameState; actor: Actor }) {
  const [open, setOpen] = useState(false);
  const ids = s.siegeDecks[actor];
  return (
    <div className="section">
      <button className="small" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'} {actor === 'warlord' ? 'Warlord' : CHARACTER_DEFS[actor].name}'s siege deck ({ids.length})</button>
      {open && <div className="hand" style={{ marginTop: 6 }}>{ids.map((c, i) => <CardView key={i} id={c} />)}</div>}
    </div>
  );
}

export function LogPanel({ s, viewer }: { s: GameState; viewer: Viewer }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }); }, [s.log.length]);
  return (
    <div className="panel log" ref={ref}>
      {s.log.filter((l) => canSee(viewer, l.vis)).map((l, i) => (
        <div key={i} className={`${l.tag ?? ''} ${l.vis !== 'all' ? 'private' : ''}`}>{l.vis !== 'all' ? '🔒 ' : ''}{l.text}</div>
      ))}
    </div>
  );
}

export function DebugPanel({ s, dispatch, reveal, setReveal, undo, canUndo, load, aiStep, newWithSeed }: {
  s: GameState; dispatch: (a: Action) => string | null; reveal: boolean; setReveal: (v: boolean) => void;
  undo: () => void; canUndo: boolean; load: (g: GameState) => void; aiStep: () => void; newWithSeed: (seed: string) => void;
}) {
  const [side, setSide] = useState<Side>('defender');
  const [amt, setAmt] = useState(5);
  const [json, setJson] = useState('');
  const [seed, setSeed] = useState(String(s.seed));
  const [msg, setMsg] = useState<string | null>(null);
  const res = side === 'defender' ? ['stone', 'wood', 'gold', 'food'] : ['supplies', 'timber', 'gold'];
  return (
    <div className="panel">
      <h3>🛠 Debug</h3>
      <div className="col">
        <label><input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} /> Reveal hidden cards & info</label>
        <div className="row">
          <select value={side} onChange={(e) => setSide(e.target.value as Side)}><option value="defender">Defenders</option><option value="warlord">Warlord</option></select>
          +<input type="number" style={{ width: 50 }} value={amt} onChange={(e) => setAmt(Number(e.target.value))} />
          <button className="small" onClick={() => setMsg(dispatch({ type: 'debugGrant', side, resources: Object.fromEntries(res.map((r) => [r, amt])) }))}>Grant all</button>
        </div>
        <div className="row">
          <button className="small" onClick={() => setMsg(dispatch({ type: 'debugSkipToHorns' }))}>Jump to War Horns</button>
          <button className="small" disabled={!canUndo} onClick={undo}>Undo</button>
          <button className="small" onClick={aiStep}>AI takes this move</button>
        </div>
        <div className="row">
          seed <input style={{ width: 110 }} value={seed} onChange={(e) => setSeed(e.target.value)} />
          <button className="small" onClick={() => newWithSeed(seed)}>Restart with seed</button>
        </div>
        <div className="row">
          <button className="small" onClick={() => download(`castle-siege-state-${s.seed}.json`, JSON.stringify(s, null, 2))}>Export state</button>
          <button className="small" onClick={() => download(`castle-siege-log-${s.seed}.txt`, logText(s, 'all'), 'text/plain')}>Export full log</button>
        </div>
        <textarea rows={3} placeholder="Paste state JSON to import" value={json} onChange={(e) => setJson(e.target.value)} />
        <div className="row">
          <button className="small" onClick={() => { try { load(JSON.parse(json)); setMsg('State imported.'); } catch (e) { setMsg(`Import failed: ${(e as Error).message}`); } }}>Import state</button>
          <label className="small">or file <input type="file" accept=".json" onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f) return;
            try { load(JSON.parse(await f.text())); setMsg('State imported.'); } catch (err) { setMsg(`Import failed: ${(err as Error).message}`); }
          }} /></label>
        </div>
        <div className="err">{msg}</div>
      </div>
    </div>
  );
}

export function EndScreen({ s, onMenu, viewer }: { s: GameState; onMenu: () => void; viewer: Viewer }) {
  const played = Object.entries(s.stats.cardsPlayed).sort((a, b) => b[1] - a[1]).slice(0, 8);
  return (
    <div className="overlay">
      <div className="modal">
        <div className="banner">{s.winner === 'defender' ? '🏰 The Keep Holds!' : '🔥 The Lord Has Fallen'}</div>
        <p style={{ textAlign: 'center' }}>{s.winner === 'defender' ? 'Defenders win' : 'The Warlord wins'} — {s.winReason}</p>
        <div className="kv">
          <span>Build rounds</span><span>{s.round} (War Horns after round {s.stats.hornsRound ?? '—'})</span>
          <span>Siege rounds</span><span>{s.siegeRound}</span>
          <span>Breaches</span><span>{s.stats.breaches.map((b) => `${b.lane} (round ${b.siegeRound})`).join(', ') || 'none'}</span>
          <span>Keep HP</span><span>{s.keep.hp}/{s.keep.maxHp}</span>
          <span>Raids</span><span>{s.stats.raids.won} won, {s.stats.raids.lost} lost</span>
          <span>Most played</span><span>{played.map(([id, n]) => `${card(id).name} ×${n}`).join(', ')}</span>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button onClick={() => download(`castle-siege-log-${s.seed}.txt`, logText(s, viewer === 'all' ? 'all' : 'all'), 'text/plain')}>Export log</button>
          <button onClick={() => download(`castle-siege-state-${s.seed}.json`, JSON.stringify(s, null, 2))}>Export state</button>
          <button className="primary" onClick={onMenu}>Main menu</button>
        </div>
      </div>
    </div>
  );
}

export function PrivacyScreen({ who, player, onReady }: { who: string; player: string; onReady: () => void }) {
  return (
    <div className="overlay">
      <div className="modal privacy">
        <div className="muted">Hot-seat — hidden information ahead</div>
        <div className="big">Pass the device to {player}</div>
        <div>({who})</div>
        <p className="muted">Everyone else, look away.</p>
        <button className="primary" onClick={onReady}>I'm {player} — show my turn</button>
      </div>
    </div>
  );
}

export function HornsBanner({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ textAlign: 'center' }}>
        <div className="banner">📯 WAR HORNS 📯</div>
        <p>The Warlord has sounded the attack. Defenders get <b>one final build round</b>, then the siege begins.</p>
        <button className="primary" onClick={onClose}>To the walls!</button>
      </div>
    </div>
  );
}

