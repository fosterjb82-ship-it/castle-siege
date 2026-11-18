
import { BUILDINGS, MAP, TROOPS, card } from '../engine';
import type { Corner, GameState, Lane, SlotRef, Structure, Troop } from '../engine';
import { SPEED_ICON, Viewer, actorName } from './uiutil';

type Rect = { x: number; y: number; w: number; h: number };

const APPROACH: Record<Lane, Rect> = {
  N: { x: 170, y: 8, w: 660, h: 140 },
  S: { x: 170, y: 852, w: 660, h: 140 },
  W: { x: 8, y: 170, w: 140, h: 660 },
  E: { x: 852, y: 170, w: 140, h: 660 },
};
const BAILEY: Record<Lane, Rect> = {
  N: { x: 200, y: 200, w: 600, h: 185 },
  S: { x: 200, y: 615, w: 600, h: 185 },
  W: { x: 200, y: 390, w: 195, h: 220 },
  E: { x: 605, y: 390, w: 195, h: 220 },
};
const KEEP: Rect = { x: 405, y: 395, w: 190, h: 210 };
const CORNER_POS: Record<Corner, [number, number]> = { NW: [180, 180], NE: [820, 180], SW: [180, 820], SE: [820, 820] };
const horizontal = (l: Lane) => l === 'N' || l === 'S';

function hpColor(st: { hp: number; maxHp: number }) {
  const r = st.hp / st.maxHp;
  return st.hp <= 0 ? '#3a2a25' : r > 0.66 ? '#9c8f78' : r > 0.33 ? '#c69a3c' : '#c4523f';
}

function abbrev(name: string) {
  return name.split(/[\s-]+/).map((w) => w[0]).join('').toUpperCase().slice(0, 3);
}

export interface BoardProps {
  s: GameState;
  viewer: Viewer;
  selected: SlotRef | null;
  onSlot: (slot: SlotRef) => void;
  highlightLanes?: Lane[];
}

function sameSlot(a: SlotRef | null, b: SlotRef) {
  return !!a && JSON.stringify(a) === JSON.stringify(b);
}

function SlotBox({ r, label, sub, side, sel, onClick, harassed }: { r: Rect; label: string | null; sub?: string; side: 'def' | 'war'; sel: boolean; onClick: () => void; harassed?: boolean }) {
  const fill = label ? (side === 'def' ? '#2b3b4d' : '#4d2b28') : 'rgba(255,255,255,0.03)';
  return (
    <g className={`slot ${sel ? 'sel' : ''}`} onClick={onClick}>
      <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={6} fill={fill} stroke={label ? (side === 'def' ? '#5b9bd5' : '#d0574b') : '#5a5040'} strokeDasharray={label ? undefined : '4 3'} strokeWidth={1.5} />
      <text x={r.x + r.w / 2} y={r.y + r.h / 2 + (sub ? -2 : 4)} textAnchor="middle" className="small-text" style={{ fontWeight: label ? 600 : 400, fill: label ? '#ece4d4' : '#7d725f' }}>
        {label ?? '+ build'}
      </text>
      {sub && <text x={r.x + r.w / 2} y={r.y + r.h / 2 + 12} textAnchor="middle" className="small-text tiny" style={{ fill: '#c9bda5' }}>{sub}</text>}
      {harassed && <text x={r.x + r.w - 6} y={r.y + 12} textAnchor="end" className="tiny" style={{ fill: '#e06c5f' }}>harassed</text>}
    </g>
  );
}

function TroopTokens({ s, troops, x, y, w, side, knight }: { s: GameState; troops: Troop[]; x: number; y: number; w: number; side: 'def' | 'war'; knight?: boolean }) {
  const groups = new Map<string, { n: number; hurt: number }>();
  for (const t of troops) {
    const g = groups.get(t.type) ?? { n: 0, hurt: 0 };
    g.n++;
    if (t.hp < TROOPS[t.type].hp) g.hurt++;
    groups.set(t.type, g);
  }
  const items: { key: string; label: string; n: number; color: string; title: string }[] = [];
  for (const [type, g] of groups) {
    items.push({ key: type, label: abbrev(TROOPS[type].name), n: g.n, color: side === 'def' ? '#3f7bb8' : '#b0453a', title: `${TROOPS[type].name} ×${g.n}${g.hurt ? ` (${g.hurt} hurt)` : ''}` });
  }
  if (knight) items.push({ key: 'knight', label: 'KN', n: 1, color: '#d9a441', title: `The Knight (HP ${s.knight.hp})` });
  const per = Math.max(1, Math.floor(w / 44));
  return (
    <g>
      {items.map((it, i) => {
        const cx = x + 20 + (i % per) * 44;
        const cy = y + 18 + Math.floor(i / per) * 40;
        return (
          <g key={it.key}>
            <title>{it.title}</title>
            <circle cx={cx} cy={cy} r={16} fill={it.color} stroke="#111" strokeWidth={1.5} />
            <text x={cx} y={cy + 4} textAnchor="middle" style={{ fontSize: 11, fontWeight: 700, fill: '#fff' }}>{it.label}</text>
            {it.n > 1 && (
              <g>
                <circle cx={cx + 13} cy={cy - 12} r={9} fill="#111" stroke={it.color} />
                <text x={cx + 13} y={cy - 8} textAnchor="middle" style={{ fontSize: 11, fontWeight: 700, fill: '#fff' }}>{it.n}</text>
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}

function WallSeg({ lane, st, gate, onWall, onGate, selWall, selGate, breached, moat }: {
  lane: Lane; st: Structure; gate: Structure; onWall: () => void; onGate: () => void; selWall: boolean; selGate: boolean; breached: boolean; moat: boolean;
}) {
  const h = horizontal(lane);
  const pos = lane === 'N' ? 180 : lane === 'S' ? 820 : lane === 'W' ? 180 : 820;
  const wallName = BUILDINGS[st.buildingId].name;
  const gateName = BUILDINGS[gate.buildingId].name;
  const thick = st.buildingId === 'stone_wall' ? 18 : 12;
  const line = h
    ? { x1: 180, y1: pos, x2: 820, y2: pos }
    : { x1: pos, y1: 180, x2: pos, y2: 820 };
  const g = h ? { x: 460, y: pos - 16, w: 80, h: 32 } : { x: pos - 16, y: 460, w: 32, h: 80 };
  const moatRect = h
    ? { x: 180, y: lane === 'N' ? 152 : 830, w: 640, h: 18 }
    : { x: lane === 'W' ? 152 : 830, y: 180, w: 18, h: 640 };
  const labelPos = h
    ? { x: 300, y: pos + (lane === 'N' ? -8 : 20) }
    : { x: pos + (lane === 'W' ? -8 : 8), y: 300 };
  return (
    <g>
      {moat && <rect {...{ x: moatRect.x, y: moatRect.y, width: moatRect.w, height: moatRect.h }} fill="#2f5d86" opacity={0.75} rx={4}><title>Moat</title></rect>}
      <g className={`slot ${selWall ? 'sel' : ''}`} onClick={onWall}>
        <title>{`${wallName}: ${st.hp}/${st.maxHp} HP, Defense ${BUILDINGS[st.buildingId].structure!.defense}`}</title>
        <line {...line} stroke={hpColor(st)} strokeWidth={thick} strokeLinecap="square" strokeDasharray={st.hp <= 0 ? '14 10' : undefined} />
        {selWall && <line {...line} stroke="#d9a441" strokeWidth={3} />}
      </g>
      <text x={labelPos.x} y={labelPos.y} className="small-text tiny" textAnchor={h ? 'start' : lane === 'W' ? 'end' : 'start'} style={{ fill: '#c9bda5' }}
        transform={h ? undefined : `rotate(${lane === 'W' ? -90 : 90} ${labelPos.x} ${labelPos.y})`}>
        {`${wallName} ${st.hp}/${st.maxHp}`}
      </text>
      <g className={`slot ${selGate ? 'sel' : ''}`} onClick={onGate}>
        <title>{`${gateName}: ${gate.hp}/${gate.maxHp} HP, Defense ${BUILDINGS[gate.buildingId].structure!.defense}${gate.tempHp ? `, +${gate.tempHp} temp` : ''}`}</title>
        <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={4} fill={gate.hp <= 0 ? '#2a201c' : '#5a4127'} stroke={hpColor(gate)} strokeWidth={3} />
        <text x={g.x + g.w / 2} y={g.y + g.h / 2 + 4} textAnchor="middle" className="hp-text">{gate.hp}/{gate.maxHp}</text>
      </g>
      {breached && (
        <text x={h ? 600 : pos} y={h ? pos + 5 : 640} textAnchor="middle" style={{ fontSize: 14, fontWeight: 800, fill: '#e06c5f' }}>BREACH</text>
      )}
    </g>
  );
}

export function Board({ s, viewer, selected, onSlot, highlightLanes = [] }: BoardProps) {
  const lanes: Lane[] = ['N', 'E', 'S', 'W'];
  const plays = s.siege?.plays ?? [];
  const revealed = s.siege?.stage === 'resolve' && (s.siege?.nextStep ?? 0) > 0;
  return (
    <svg viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet">
      <defs>
        <pattern id="grass" width="20" height="20" patternUnits="userSpaceOnUse">
          <rect width="20" height="20" fill="#232a1c" /><circle cx="5" cy="5" r="1" fill="#2c3523" />
        </pattern>
      </defs>
      <rect x={0} y={0} width={1000} height={1000} fill="url(#grass)" />
      {/* Approaches */}
      {lanes.map((l) => {
        const r = APPROACH[l];
        const h = horizontal(l);
        const nSlots = MAP.approachSlots[l];
        const slotW = h ? 150 : 124;
        const slotH = h ? 40 : 46;
        const engines = s.engines.filter((e) => e.lane === l);
        const troops = s.troops.filter((t) => t.side === 'warlord' && t.lane === l && t.zone === 'approach');
        const hl = highlightLanes.includes(l);
        return (
          <g key={`a${l}`}>
            <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={10} fill={hl ? 'rgba(208,87,75,0.18)' : 'rgba(0,0,0,0.25)'} stroke={hl ? '#d0574b' : '#3d3628'} />
            <text x={h ? r.x + 10 : r.x + r.w / 2} y={h ? r.y + 18 : r.y + 18} textAnchor={h ? 'start' : 'middle'} className="zone-label">
              {MAP.laneNames[l].toUpperCase()} APPROACH
            </text>
            {Array.from({ length: nSlots }).map((_, i) => {
              const b = s.approaches[l][i];
              const slot: SlotRef = { kind: 'approach', lane: l, index: i };
              const sr = h
                ? { x: r.x + 200 + i * (slotW + 10), y: r.y + 8, w: slotW, h: slotH }
                : { x: r.x + 8, y: r.y + 30 + i * (slotH + 8), w: slotH === 46 ? 124 : slotW, h: slotH };
              return <SlotBox key={i} r={sr} label={b ? BUILDINGS[b.buildingId].name : null} side="war" sel={sameSlot(selected, slot)} onClick={() => onSlot(slot)} />;
            })}
            <TroopTokens s={s} troops={troops} side="war" x={h ? r.x + 6 : r.x + 4} y={h ? r.y + 56 : r.y + 200} w={h ? 400 : 132} />
            {engines.map((e, i) => {
              const ex = h ? r.x + 440 + i * 56 : r.x + 10 + (i % 2) * 64;
              const ey = h ? r.y + 62 : r.y + 340 + Math.floor(i / 2) * 50;
              return (
                <g key={e.uid}>
                  <title>{`${card(e.cardId).name} (target ${e.target})`}</title>
                  <rect x={ex} y={ey} width={52} height={40} rx={5} fill="#6b3b1f" stroke="#e0a060" />
                  <text x={ex + 26} y={ey + 17} textAnchor="middle" style={{ fontSize: 15 }}>⚙️</text>
                  <text x={ex + 26} y={ey + 34} textAnchor="middle" style={{ fontSize: 10, fill: '#fff', fontWeight: 700 }}>{abbrev(card(e.cardId).name)}</text>
                </g>
              );
            })}
          </g>
        );
      })}
      {/* Castle ground */}
      <rect x={180} y={180} width={640} height={640} fill="#3a3326" />
      {/* Baileys */}
      {lanes.map((l) => {
        const r = BAILEY[l];
        const h = horizontal(l);
        const n = MAP.baileySlots[l];
        const defenders = s.troops.filter((t) => t.side === 'defender' && t.lane === l);
        const invaders = s.troops.filter((t) => t.side === 'warlord' && t.lane === l && t.zone === 'bailey');
        return (
          <g key={`b${l}`}>
            <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={8} fill={s.breached[l] ? '#4a2c26' : '#433b2d'} stroke="#5d5341" />
            <text x={r.x + 8} y={r.y + 16} className="zone-label" style={{ fontSize: 12 }}>{MAP.laneNames[l].toUpperCase()} BAILEY</text>
            {Array.from({ length: n }).map((_, i) => {
              const b = s.baileys[l][i];
              const slot: SlotRef = { kind: 'bailey', lane: l, index: i };
              const sr = h ? { x: r.x + 10 + i * 196, y: r.y + 24, w: 186, h: 44 } : { x: r.x + 8, y: r.y + 24 + i * 50, w: r.w - 16, h: 44 };
              const sub = b?.troopType ? `+1 ${TROOPS[b.troopType].name}` : undefined;
              return <SlotBox key={i} r={sr} label={b ? BUILDINGS[b.buildingId].name : null} sub={sub} side="def" sel={sameSlot(selected, slot)} onClick={() => onSlot(slot)} harassed={!!b && s.harassed.includes(b.uid)} />;
            })}
            <TroopTokens s={s} troops={defenders} side="def" knight={s.knight.lane === l && s.knight.hp > 0} x={r.x + 4} y={h ? r.y + 80 : r.y + 128} w={h ? 360 : r.w - 8} />
            {invaders.length > 0 && <TroopTokens s={s} troops={invaders} side="war" x={h ? r.x + 400 : r.x + 4} y={h ? r.y + 80 : r.y + 172} w={h ? 190 : r.w - 8} />}
          </g>
        );
      })}
      {/* Keep */}
      <g>
        <rect x={KEEP.x} y={KEEP.y} width={KEEP.w} height={KEEP.h} rx={10} fill="#5b4a30" stroke="#d9a441" strokeWidth={3} />
        <text x={500} y={440} textAnchor="middle" className="zone-label" style={{ fill: '#ecd7a5' }}>KEEP</text>
        <text x={500} y={475} textAnchor="middle" style={{ fontSize: 26 }}>👑</text>
        <text x={500} y={505} textAnchor="middle" className="small-text">The Lord</text>
        <rect x={430} y={520} width={140} height={14} rx={4} fill="#2a2018" />
        <rect x={430} y={520} width={140 * Math.max(0, s.keep.hp) / s.keep.maxHp} height={14} rx={4} fill={hpColor(s.keep)} />
        <text x={500} y={556} textAnchor="middle" className="hp-text">HP {s.keep.hp}/{s.keep.maxHp} · Def {s.keep.defense}</text>
        {s.knight.lane === null && s.knight.hp > 0 && <text x={500} y={585} textAnchor="middle" className="small-text">Knight in the Keep</text>}
        {s.knight.downUntilSiegeRound !== null && <text x={500} y={585} textAnchor="middle" className="small-text" style={{ fill: '#e06c5f' }}>Knight recovering</text>}
      </g>
      {/* Walls and gates */}
      {lanes.map((l) => (
        <WallSeg key={`w${l}`} lane={l} st={s.walls[l]} gate={s.gates[l]} breached={s.breached[l]} moat={s.moats[l]}
          selWall={sameSlot(selected, { kind: 'wall', lane: l })} selGate={sameSlot(selected, { kind: 'gate', lane: l })}
          onWall={() => onSlot({ kind: 'wall', lane: l })} onGate={() => onSlot({ kind: 'gate', lane: l })} />
      ))}
      {/* Moat build targets */}
      {lanes.filter((l) => !s.moats[l]).map((l) => {
        const h = horizontal(l);
        const r = h ? { x: 700, y: l === 'N' ? 152 : 830, w: 110, h: 18 } : { x: l === 'W' ? 152 : 830, y: 700, w: 18, h: 110 };
        const slot: SlotRef = { kind: 'moat', lane: l };
        return (
          <g key={`m${l}`} className={`slot ${sameSlot(selected, slot) ? 'sel' : ''}`} onClick={() => onSlot(slot)}>
            <title>Dig a moat</title>
            <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={4} fill="rgba(47,93,134,0.25)" stroke="#2f5d86" strokeDasharray="4 3" />
            <text x={r.x + r.w / 2} y={r.y + r.h / 2 + 4} textAnchor="middle" className="tiny" style={{ fill: '#8fb7dc' }}
              transform={h ? undefined : `rotate(90 ${r.x + r.w / 2} ${r.y + r.h / 2})`}>moat</text>
          </g>
        );
      })}
      {/* Towers */}
      {(Object.keys(CORNER_POS) as Corner[]).map((c) => {
        const [cx, cy] = CORNER_POS[c];
        const t = s.towers[c];
        const slot: SlotRef = { kind: 'tower', corner: c };
        return (
          <g key={c} className={`slot ${sameSlot(selected, slot) ? 'sel' : ''}`} onClick={() => onSlot(slot)}>
            <title>{t ? `${BUILDINGS[t.buildingId].name} ${t.hp}/${t.maxHp} HP (covers ${MAP.towers[c].covers.join(' & ')})` : `${c} tower slot (covers ${MAP.towers[c].covers.join(' & ')})`}</title>
            <rect x={cx - 32} y={cy - 32} width={64} height={64} rx={10} fill={t ? (t.buildingId === 'stone_tower' ? '#7d7466' : '#6b5a3e') : '#2e281f'} stroke={sameSlot(selected, slot) ? '#d9a441' : '#9c8f78'} strokeWidth={sameSlot(selected, slot) ? 3 : 2} strokeDasharray={t ? undefined : '5 4'} />
            <text x={cx} y={cy - 4} textAnchor="middle" style={{ fontSize: 13, fontWeight: 700, fill: '#fff' }}>{c}</text>
            <text x={cx} y={cy + 14} textAnchor="middle" className="tiny" style={{ fill: '#ece4d4' }}>{t ? `${t.buildingId === 'stone_tower' ? 'Stone' : 'Arrow'} ${t.hp}` : 'tower'}</text>
          </g>
        );
      })}
      {/* Siege plays */}
      {lanes.map((l) => {
        const lp = plays.filter((p) => p.lane === l);
        if (!lp.length) return null;
        const h = horizontal(l);
        const baseX = h ? 560 : l === 'W' ? 40 : 870;
        const baseY = h ? (l === 'N' ? 120 : 862) : 700;
        return (
          <g key={`p${l}`}>
            {lp.map((p, i) => {
              const own = viewer === 'all' || (viewer === 'warlord' && p.actor === 'warlord') || (viewer === 'defender' && p.actor !== 'warlord');
              const show = revealed || own;
              const c = card(p.cardId);
              const x = h ? baseX + i * 30 : baseX + (i % 3) * 30;
              const y = h ? baseY : baseY + Math.floor(i / 3) * 30;
              const isW = p.actor === 'warlord';
              return (
                <g key={i}>
                  <title>{show ? `${actorName(p.actor)}: ${c.name} — ${c.text}` : `${actorName(p.actor)}: face-down card`}</title>
                  <rect x={x} y={y} width={26} height={26} rx={4} fill={show ? (isW ? '#ecd3c9' : '#e9dcc0') : '#5a3f22'} stroke={isW ? '#d0574b' : '#5b9bd5'} strokeWidth={2} />
                  <text x={x + 13} y={y + 18} textAnchor="middle" style={{ fontSize: 13 }}>{show ? SPEED_ICON[c.speed] : '?'}</text>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
