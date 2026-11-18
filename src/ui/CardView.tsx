
import { card, laneName } from '../engine';
import { SPEED_ICON } from './uiutil';

export function CardView({ id, onClick, selected, used, faceDown, label }: { id: string; onClick?: () => void; selected?: boolean; used?: boolean; faceDown?: boolean; label?: string }) {
  if (faceDown) return <div className="card back">{label ?? 'Siege card'}</div>;
  const c = card(id);
  return (
    <div className={`card ${c.side === 'warlord' ? 'war' : ''} ${onClick ? 'clickable' : ''} ${selected ? 'sel' : ''} ${used ? 'used' : ''}`} onClick={onClick} title={c.text}>
      <div className="cname">{c.name}</div>
      <div className="meta">
        <span>{SPEED_ICON[c.speed]} {c.speed}</span>
        <span>{c.laneRule !== 'any' && c.laneRule !== 'none' ? `${laneName(c.laneRule)} only` : c.deck}</span>
      </div>
      <div>{c.text}</div>
      {label && <div style={{ marginTop: 'auto', fontWeight: 700 }}>{label}</div>}
    </div>
  );
}
