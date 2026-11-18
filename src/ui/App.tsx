import React, { useCallback, useEffect, useRef, useState } from 'react';
import { aiAction, applyAction, createGame, tryAction, util } from '../engine';
import type { Action, GameState, SlotRef } from '../engine';
import { Board } from './Board';
import { ChooseCharacterPanel, DraftPanel, HornsPanel, TurnPanel } from './BuildPanel';
import { Menu } from './Menu';
import { DebugPanel, DeckPeek, EndScreen, HornsBanner, LogPanel, PrivacyScreen, StockPanels } from './Panels';
import { SetupPanel, SiegePlanPanel, SiegeResolvePanel } from './SiegePanel';
import { Viewer, activeAIActor, activeHumanActor, actorName, download, logText, playerOf } from './uiutil';

const SAVE_KEY = 'castle-siege-save-v1';
const AI_DELAY = 450;

function loadSave(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? (JSON.parse(raw) as GameState) : null;
  } catch { return null; }
}

function humanPlayers(s: GameState) {
  return s.config.players.filter((p) => !p.ai);
}

/** Which human player should be holding the device right now (null = no privacy needed). */
function privacyKey(s: GameState): { key: string; who: string } | null {
  if (humanPlayers(s).length < 2 || s.winner) return null;
  if (s.step === 'chooseCharacter') {
    const owners = new Set(s.config.players.filter((p) => !p.ai && p.controls.some((c) => c !== 'warlord')).map((p) => p.name));
    const name = owners.size === 1 ? [...owners][0] : 'Defenders';
    return { key: name, who: 'the defenders choose who acts next' };
  }
  if (s.step === 'siege' && s.siege!.stage === 'resolve') return null;
  const a = activeHumanActor(s);
  if (!a) return null;
  if (s.step === 'setup') return { key: playerOf(s, a), who: a === 'warlord' ? 'Warlord setup' : 'Defender setup' };
  return { key: playerOf(s, a), who: actorName(a) };
}

export function App() {
  const [game, setGame] = useState<GameState | null>(null);
  const ref = useRef<GameState | null>(null);
  const [history, setHistory] = useState<GameState[]>([]);
  const [selected, setSelected] = useState<SlotRef | null>(null);
  const [debug, setDebug] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [auto, setAuto] = useState(false);
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [horns, setHorns] = useState(false);
  const [saved, setSaved] = useState(!!loadSave());

  const commit = useCallback((next: GameState, prev: GameState | null) => {
    if (prev && !prev.hornsSounded && next.hornsSounded) setHorns(true);
    ref.current = next;
    setGame(next);
    if (prev) setHistory((h) => [...h.slice(-199), prev]);
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(next)); setSaved(true); } catch { /* storage unavailable */ }
  }, []);

  const dispatch = useCallback((a: Action): string | null => {
    const cur = ref.current;
    if (!cur) return 'No game';
    const r = tryAction(cur, a);
    if (!r.ok) return r.error;
    commit(r.state, cur);
    return null;
  }, [commit]);

  // AI pacing: one AI action at a time so players can follow along.
  useEffect(() => {
    if (!game || game.winner) return;
    const ai = activeAIActor(game);
    const resolving = game.step === 'siege' && game.siege!.stage === 'resolve';
    const allAI = humanPlayers(game).length === 0;
    if (ai && !(resolving)) {
      const t = setTimeout(() => {
        const cur = ref.current!;
        const actor = activeAIActor(cur);
        if (!actor) return;
        try { commit(applyAction(cur, aiAction(cur, actor)), cur); } catch (e) { console.error('AI action failed', e); }
      }, allAI ? 120 : AI_DELAY);
      return () => clearTimeout(t);
    }
    if (resolving && (auto || allAI)) {
      const t = setTimeout(() => dispatch({ type: 'advanceSiege' }), allAI ? 250 : 700);
      return () => clearTimeout(t);
    }
  }, [game, auto, commit, dispatch]);

  const start = (g: GameState, opts: { debug?: boolean }) => {
    ref.current = g; setGame(g); setHistory([]); setSelected(null); setConfirmed(null);
    setDebug(!!opts.debug); setReveal(!!opts.debug); setAuto(false);
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(g)); } catch { /* ignore */ }
  };

  if (!game) {
    return <Menu saved={saved} onStart={start} onContinue={() => { const g = loadSave(); if (g) start(g, {}); }} />;
  }

  const s = game;
  const pk = privacyKey(s);
  const needPrivacy = !!pk && pk.key !== confirmed && !reveal;
  const human = activeHumanActor(s);
  let viewer: Viewer;
  if (reveal) viewer = 'all';
  else if (s.config.mode === 'coop') viewer = humanPlayers(s).length ? 'defender' : 'all';
  else if (human) viewer = util.sideOf(human);
  else if (s.step === 'chooseCharacter') viewer = 'defender';
  else viewer = 'public';

  const props = { s, dispatch, selected, setSelected };
  let panel: React.ReactNode;
  if (s.winner) panel = <div className="muted">Game over.</div>;
  else if (s.step === 'setup') panel = human ? <SetupPanel s={s} actor={human} dispatch={dispatch} /> : <Waiting text="Waiting for the AI to place…" />;
  else if (s.step === 'chooseCharacter') panel = human ? <ChooseCharacterPanel {...props} /> : <Waiting />;
  else if (s.step === 'draftPick') panel = human ? <DraftPanel {...props} /> : <Waiting />;
  else if (s.step === 'hornsDecision') panel = human ? <HornsPanel {...props} /> : <Waiting text="The Warlord considers the War Horns…" />;
  else if (s.step === 'defenderTurn' || s.step === 'warlordTurn') {
    panel = human ? <>{<TurnPanel key={`${s.round}-${human}`} {...props} />}<DeckPeek s={s} actor={human} /></> : <Waiting text={`${actorName(s.step === 'warlordTurn' ? 'warlord' : s.turn.current!)} is acting…`} />;
  } else if (s.step === 'siege') {
    if (s.siege!.stage === 'resolve') panel = <SiegeResolvePanel s={s} dispatch={dispatch} auto={auto} setAuto={setAuto} />;
    else panel = human ? <SiegePlanPanel s={s} actor={human} dispatch={dispatch} /> : <Waiting text="The AI is planning…" />;
  }

  const phaseText = s.phase === 'setup' ? 'Setup'
    : s.phase === 'build' ? `Build round ${s.round}${s.finalBuildRound ? ' (final)' : ''} · ${s.step === 'warlordTurn' ? 'Warlord responds' : s.turn.current ? `${actorName(s.turn.current)}'s turn` : ''}`
    : s.phase === 'siege' ? `Siege round ${s.siegeRound} · ${s.siege!.stage === 'plan' ? 'planning' : 'resolving'}`
    : 'Game over';

  return (
    <div className="app">
      <div className="topbar">
        <span className="title">🏰 CASTLE SIEGE</span>
        <span className="phase">{phaseText} · {s.config.mode === 'coop' ? `Co-op (${s.config.difficulty})` : 'Warlord mode'} · seed {s.seed}</span>
        <button className="small" onClick={() => download(`castle-siege-save-${s.seed}.json`, JSON.stringify(s))}>Save file</button>
        <button className="small" onClick={() => download(`castle-siege-log-${s.seed}.txt`, logText(s, viewer === 'public' ? 'public' : viewer), 'text/plain')}>Export log</button>
        <button className={`small ${debug ? 'selected' : ''}`} onClick={() => setDebug(!debug)}>Debug</button>
        <button className="small" onClick={() => setGame(null)}>Menu</button>
      </div>
      <div className="main">
        <div className="leftcol">
          <StockPanels s={s} viewer={viewer} />
          {debug && (
            <DebugPanel s={s} dispatch={dispatch} reveal={reveal} setReveal={setReveal} canUndo={history.length > 0}
              undo={() => { const prev = history[history.length - 1]; if (prev) { ref.current = prev; setGame(prev); setHistory(history.slice(0, -1)); } }}
              load={(g) => commit(g, s)}
              aiStep={() => {
                const a = activeHumanActor(s) ?? activeAIActor(s);
                if (a) { try { commit(applyAction(s, aiAction(s, a)), s); } catch (e) { alert((e as Error).message); } }
              }}
              newWithSeed={(seed) => start(createGame({ mode: s.config.mode, difficulty: s.config.difficulty, players: s.config.players, seed: /^-?\d+$/.test(seed) ? Number(seed) : seed }), { debug: true })} />
          )}
        </div>
        <div className="centercol">
          <div className="boardwrap"><Board s={s} viewer={viewer} selected={selected} onSlot={setSelected} /></div>
          <LogPanel s={s} viewer={viewer} />
        </div>
        <div className="rightcol">
          <div className="panel" style={{ flex: 1 }}>{needPrivacy ? <Waiting text="Waiting for the next player…" /> : panel}</div>
        </div>
      </div>
      {needPrivacy && pk && <PrivacyScreen who={pk.who} player={pk.key} onReady={() => setConfirmed(pk.key)} />}
      {horns && !needPrivacy && <HornsBanner onClose={() => setHorns(false)} />}
      {s.winner && <EndScreen s={s} viewer={viewer} onMenu={() => setGame(null)} />}
    </div>
  );
}

function Waiting({ text = 'Waiting…' }: { text?: string }) {
  return <div className="muted" style={{ padding: 20, textAlign: 'center' }}>⏳ {text}</div>;
}
