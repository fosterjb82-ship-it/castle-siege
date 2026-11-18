import { useState } from 'react';
import { CHARACTER_DEFS, createGame } from '../engine';
import type { Actor, CharacterId, Difficulty, GameState, Mode, PlayerSlot } from '../engine';

const CHARS: CharacterId[] = ['lord', 'architect', 'quartermaster', 'knight'];

export function Menu({ onStart, saved, onContinue }: { onStart: (g: GameState, opts: { debug?: boolean }) => void; saved: boolean; onContinue: () => void }) {
  const [mode, setMode] = useState<Mode>('coop');
  const [humans, setHumans] = useState(1);
  const [names, setNames] = useState(['Player 1', 'Player 2', 'Player 3', 'Player 4']);
  const [warlordName, setWarlordName] = useState('Warlord');
  const [assign, setAssign] = useState<Record<CharacterId, number>>({ lord: 0, architect: 0, quartermaster: 0, knight: 0 });
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [seed, setSeed] = useState('');
  const [aiDefenders, setAiDefenders] = useState(false);

  const setHumanCount = (n: number) => {
    setHumans(n);
    const a = { ...assign };
    CHARS.forEach((c, i) => { a[c] = i % n; });
    setAssign(a);
  };

  const start = (debug = false) => {
    let players: PlayerSlot[];
    if (aiDefenders) {
      players = [{ name: 'AI Defenders', controls: [...CHARS], ai: true }];
    } else {
      players = names.slice(0, humans).map((name, i) => ({ name, controls: CHARS.filter((c) => assign[c] === i) as Actor[] }))
        .filter((p) => p.controls.length);
    }
    players.push(mode === 'coop' ? { name: 'AI Warlord', controls: ['warlord'], ai: true } : { name: warlordName, controls: ['warlord'] });
    const g = createGame({ mode, difficulty, players, seed: seed.trim() === '' ? undefined : (/^-?\d+$/.test(seed) ? Number(seed) : seed) });
    onStart(g, { debug });
  };

  return (
    <div className="menu">
      <h1>🏰 Castle Siege</h1>
      <p className="muted">Beta build — a co-op castle-building and siege card game. Build for a few rounds, draft a hidden siege deck, then hold the Keep.</p>
      <div className="panel col">
        {saved && <button className="primary" onClick={onContinue}>Continue saved game</button>}
        <h2>New game</h2>
        <table><tbody>
          <tr><td>Mode</td><td>
            <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
              <option value="coop">Co-op vs AI Warlord</option>
              <option value="warlord">Warlord (hot-seat, human Warlord)</option>
            </select>
          </td></tr>
          {mode === 'coop' && <tr><td>Difficulty</td><td>
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
              <option value="easy">Easy (Warlord income ×0.75)</option>
              <option value="normal">Normal</option>
              <option value="hard">Hard (Warlord income ×1.25)</option>
            </select>
          </td></tr>}
          <tr><td>Defender players</td><td>
            <select value={humans} disabled={aiDefenders} onChange={(e) => setHumanCount(Number(e.target.value))}>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            {mode === 'coop' && <label style={{ marginLeft: 10 }}><input type="checkbox" checked={aiDefenders} onChange={(e) => setAiDefenders(e.target.checked)} /> AI defenders too (watch AI vs AI)</label>}
          </td></tr>
          {!aiDefenders && names.slice(0, humans).map((n, i) => (
            <tr key={i}><td>Player {i + 1} name</td><td><input value={n} onChange={(e) => setNames(names.map((x, j) => (j === i ? e.target.value : x)))} /></td></tr>
          ))}
          {mode === 'warlord' && <tr><td>Warlord player</td><td><input value={warlordName} onChange={(e) => setWarlordName(e.target.value)} /></td></tr>}
          {!aiDefenders && humans > 1 && CHARS.map((c) => (
            <tr key={c}><td>{CHARACTER_DEFS[c].name}</td><td>
              <select value={assign[c]} onChange={(e) => setAssign({ ...assign, [c]: Number(e.target.value) })}>
                {names.slice(0, humans).map((n, i) => <option key={i} value={i}>{n}</option>)}
              </select>
            </td></tr>
          ))}
          <tr><td>Seed</td><td><input placeholder="random" value={seed} onChange={(e) => setSeed(e.target.value)} /> <span className="muted">same seed + same moves = same game</span></td></tr>
        </tbody></table>
        <div className="row">
          <button className="primary" onClick={() => start(false)}>Start game</button>
          <button onClick={() => start(true)}>Debug sandbox</button>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>All four characters are always in play; with fewer players, players split them. In hot-seat, a "pass the device" screen hides hands and face-down plays.</p>
      </div>
    </div>
  );
}
