import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Category, LocalAsset } from '@sticker-v1/types';
import { defaultHeroTransform, resizeFromTopLeft, type ImageTransform } from '@sticker-v1/utils/imageTransform';

interface EditableImageCanvasProps {
  image?: LocalAsset;
  category?: Category;
  transform: ImageTransform;
  lockAspectRatio: boolean;
  onTransformChange: (transform: ImageTransform) => void;
}

type Interaction =
  | { type: 'move'; pointerId: number; startPointer: { x: number; y: number }; startTransform: ImageTransform }
  | { type: 'resize'; pointerId: number; startTransform: ImageTransform };

const canvasSize = { width: 900, height: 1427 };

function getCanvasPoint(element: HTMLDivElement, event: PointerEvent) {
  const rect = element.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvasSize.width,
    y: ((event.clientY - rect.top) / rect.height) * canvasSize.height,
  };
}

export function EditableImageCanvas({
  image,
  category,
  transform,
  lockAspectRatio,
  onTransformChange,
}: EditableImageCanvasProps) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [selected, setSelected] = useState(false);
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  const palette = category?.palette ?? {
    primary: '#111111',
    secondary: '#F5F5F5',
    accent: '#F36C21',
    neutral: '#D9D9D9',
  };

  useEffect(() => {
    if (!selected) return;

    function isTextInputFocused() {
      const activeElement = document.activeElement;
      if (!(activeElement instanceof HTMLElement)) return false;
      const tagName = activeElement.tagName.toLowerCase();
      return (
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select' ||
        activeElement.isContentEditable
      );
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (isTextInputFocused()) return;

      const deltas: Record<string, { x: number; y: number } | undefined> = {
        ArrowLeft: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 },
        ArrowUp: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 },
      };
      const delta = deltas[event.key];
      if (!delta) return;

      event.preventDefault();
      onTransformChange({
        ...transform,
        x: transform.x + delta.x,
        y: transform.y + delta.y,
      });
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onTransformChange, selected, transform]);

  function beginMove(event: PointerEvent<HTMLDivElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelected(true);
    setInteraction({
      type: 'move',
      pointerId: event.pointerId,
      startPointer: getCanvasPoint(canvas, event),
      startTransform: transform,
    });
  }

  function beginResize(event: PointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelected(true);
    setInteraction({ type: 'resize', pointerId: event.pointerId, startTransform: transform });
  }

  function handleCanvasPointerDown(event: PointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest('[data-image-transform-control="true"]')) return;
    setSelected(false);
  }

  function updateInteraction(event: PointerEvent<HTMLElement>) {
    const canvas = canvasRef.current;
    if (!canvas || !interaction || interaction.pointerId !== event.pointerId) return;
    const point = getCanvasPoint(canvas, event as PointerEvent<HTMLDivElement>);

    if (interaction.type === 'move') {
      onTransformChange({
        ...interaction.startTransform,
        x: interaction.startTransform.x + point.x - interaction.startPointer.x,
        y: interaction.startTransform.y + point.y - interaction.startPointer.y,
      });
      return;
    }

    onTransformChange(resizeFromTopLeft(interaction.startTransform, point, lockAspectRatio));
  }

  function endInteraction(event: PointerEvent<HTMLElement>) {
    if (interaction?.pointerId === event.pointerId) setInteraction(null);
  }

  return (
    <div className="overflow-auto rounded-lg border border-line bg-neutral-100 p-4">
      <div
        ref={canvasRef}
        className="relative mx-auto aspect-[900/1427] w-full max-w-[460px] overflow-visible rounded-xl shadow-surface"
        style={{ background: palette.secondary }}
        onPointerMove={updateInteraction}
        onPointerUp={endInteraction}
        onPointerCancel={endInteraction}
        onPointerDown={handleCanvasPointerDown}
      >
        <div
          className="absolute inset-x-0 top-0 flex h-[12%] items-center px-5 text-sm font-bold"
          style={{ background: palette.primary, color: palette.neutral }}
        >
          Front image editor
        </div>
        <div
          className="absolute overflow-hidden rounded-md bg-neutral-200"
          style={{
            left: `${(defaultHeroTransform.x / canvasSize.width) * 100}%`,
            top: `${(defaultHeroTransform.y / canvasSize.height) * 100}%`,
            width: `${(defaultHeroTransform.width / canvasSize.width) * 100}%`,
            height: `${(defaultHeroTransform.height / canvasSize.height) * 100}%`,
          }}
        >
          <div
            className="absolute select-none"
            style={{
              left: `${((transform.x - defaultHeroTransform.x) / defaultHeroTransform.width) * 100}%`,
              top: `${((transform.y - defaultHeroTransform.y) / defaultHeroTransform.height) * 100}%`,
              width: `${(transform.width / defaultHeroTransform.width) * 100}%`,
              height: `${(transform.height / defaultHeroTransform.height) * 100}%`,
            }}
          >
            {image?.objectUrl ? (
              <img src={image.objectUrl} alt="" draggable={false} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-neutral-300 text-sm text-neutral-600">
                Hero placeholder
              </div>
            )}
          </div>
        </div>

        <div
          data-image-transform-control="true"
          className="absolute cursor-move touch-none select-none"
          style={{
            left: `${(transform.x / canvasSize.width) * 100}%`,
            top: `${(transform.y / canvasSize.height) * 100}%`,
            width: `${(transform.width / canvasSize.width) * 100}%`,
            height: `${(transform.height / canvasSize.height) * 100}%`,
          }}
          onPointerDown={beginMove}
        >
          {selected && (
            <>
              <div className="pointer-events-none absolute inset-0 border-2 border-zaparoo" />
              {['left-0 top-0', 'right-0 top-0', 'left-0 bottom-0', 'right-0 bottom-0'].map((position) => (
                <button
                  key={position}
                  type="button"
                  aria-label="Resize image"
                  onPointerDown={beginResize}
                  className={`absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-zaparoo shadow ${position}`}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
