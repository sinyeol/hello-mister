import { ArrowLeft, ArrowRight, Home } from 'lucide-react';
import { Link } from 'react-router-dom';

const steps = [
  { to: '/stickers/images', label: '이미지 가져오기' },
  { to: '/stickers/templates', label: '템플릿 고르기' },
  { to: '/stickers/editor', label: '카드 만들기' },
  { to: '/stickers/album', label: '앨범 확인' },
  { to: '/stickers/output', label: '시트 출력' },
];

interface StickerStepNavProps {
  current: string;
  previous?: string;
  next?: string;
}

export function StickerStepNav({ current, previous, next }: StickerStepNavProps) {
  return (
    <div className="sticker-step-nav">
      <Link className="button small" to="/stickers"><Home size={16} />허브</Link>
      {previous && <Link className="button small" to={previous}><ArrowLeft size={16} />이전 단계</Link>}
      <div className="sticker-step-pills">
        {steps.map((step, index) => (
          <Link key={step.to} className={`flow-step ${step.to === current ? 'active' : ''}`} data-step={index + 1} to={step.to}>
            {step.label}
          </Link>
        ))}
      </div>
      {next && <Link className="button primary small" to={next}>다음 단계<ArrowRight size={16} /></Link>}
    </div>
  );
}
