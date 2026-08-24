import { BUTTON_POSITIONS } from '../../services/controllers/controllerReference';
import type { ControllerReferenceEntry } from '../../types/controllers';

// Graphic reference-capture surface. Click a shape to "arm" it, then press that input on the controller — the parent
// (ControllerSetupPage) routes the live HID event into the armed slot. This phase-1 rendering is a plain chip grid; the
// props contract (directions/buttons/armed/onArm/onClear) is final, so phase 2 only swaps the inner rendering for a
// Vewlix SVG — no interface change.

interface JoystickCaptureMapProps {
  directions: Record<string, ControllerReferenceEntry>;
  buttons: ControllerReferenceEntry[];
  armed: string | null;
  onArm: (id: string) => void;
  onClear: (id: string) => void;
}

const DIR_LABEL: Record<string, string> = { up: '↑', down: '↓', left: '←', right: '→' };
// 3×3 grid placement for the lever (empty cells are layout spacers).
const LEVER_LAYOUT: string[] = ['', 'up', '', 'left', '', 'right', '', 'down', ''];

export function JoystickCaptureMap({ directions, buttons, armed, onArm, onClear }: JoystickCaptureMapProps) {
  const byPos = new Map<string, ControllerReferenceEntry>();
  for (const b of buttons) if (b.pos) byPos.set(b.pos, b);

  const chip = (id: string, label: string, entry?: ControllerReferenceEntry) => {
    const filled = Boolean(entry);
    const isArmed = armed === id;
    const border = isArmed ? '#eab308' : filled ? '#16a34a' : '#cbd5e1';
    const background = isArmed ? '#fef08a' : filled ? '#dcfce7' : '#f8fafc';
    // Directions are captured as axis/hat (no button usage); only real buttons show "버튼 N".
    const filledText = entry ? (entry.kind === 'button' ? (entry.usage != null ? `버튼 ${entry.usage}` : (entry.label || '캡처됨 ✓')) : '축/햇 ✓') : '';
    return (
      <button
        key={id}
        type="button"
        onClick={() => onArm(id)}
        title={filled ? filledText : '클릭 후 컨트롤러에서 누르세요'}
        style={{
          position: 'relative',
          minWidth: 66,
          minHeight: 56,
          border: `2px solid ${border}`,
          background,
          borderRadius: 10,
          cursor: 'pointer',
          padding: '6px 8px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
        }}
      >
        <span style={{ fontSize: 18, fontWeight: 600, lineHeight: 1 }}>{label}</span>
        <span style={{ fontSize: 11, color: filled ? '#166534' : '#94a3b8' }}>
          {filled ? filledText : isArmed ? '누르세요…' : '비어있음'}
        </span>
        {filled && (
          <span
            role="button"
            aria-label="지우기"
            onClick={(e) => {
              e.stopPropagation();
              onClear(id);
            }}
            style={{ position: 'absolute', top: 1, right: 5, fontSize: 13, color: '#64748b', lineHeight: 1 }}
          >
            ×
          </span>
        )}
      </button>
    );
  };

  const emptyCell = (i: number) => <span key={`empty-${i}`} aria-hidden style={{ minWidth: 66, minHeight: 56 }} />;

  return (
    <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-start', padding: '8px 0' }}>
      <div>
        <div className="muted" style={{ marginBottom: 6 }}>레버</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 66px)', gap: 6 }}>
          {LEVER_LAYOUT.map((id, i) => (id ? chip(id, DIR_LABEL[id], directions[id]) : emptyCell(i)))}
        </div>
      </div>

      <div>
        <div className="muted" style={{ marginBottom: 6 }}>버튼 (1–8)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 66px)', gap: 6 }}>
          {BUTTON_POSITIONS.filter((p) => p.id.startsWith('b')).map((p) => chip(p.id, p.label, byPos.get(p.id)))}
        </div>
      </div>

      <div>
        <div className="muted" style={{ marginBottom: 6 }}>특수</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 66px)', gap: 6 }}>
          {BUTTON_POSITIONS.filter((p) => !p.id.startsWith('b')).map((p) => chip(p.id, p.label, byPos.get(p.id)))}
        </div>
      </div>
    </div>
  );
}
