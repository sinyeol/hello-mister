import { useEffect, useState } from 'react';
import { clampPage, pageCountFor } from '@sticker-v1/utils/pagination';

interface PaginationControlsProps {
  currentPage: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  className?: string;
  itemLabel?: string;
}

export function PaginationControls({
  currentPage,
  totalItems,
  pageSize,
  onPageChange,
  className = '',
  itemLabel = 'results',
}: PaginationControlsProps) {
  const totalPages = pageCountFor(totalItems, pageSize);
  const safePage = clampPage(currentPage, totalPages);
  const [inputValue, setInputValue] = useState(String(safePage));

  useEffect(() => {
    setInputValue(String(safePage));
  }, [safePage]);

  function commitPage(value = inputValue) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
      setInputValue(String(safePage));
      return;
    }
    onPageChange(clampPage(parsed, totalPages));
  }

  const firstDisabled = safePage <= 1;
  const lastDisabled = safePage >= totalPages;
  const buttonClass = 'rounded-md border border-line px-2.5 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 hover:bg-neutral-50';

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 text-sm ${className}`}>
      <span className="text-neutral-600">
        {totalItems.toLocaleString()} {itemLabel} · Page {safePage} / {totalPages}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => onPageChange(1)} disabled={firstDisabled} className={buttonClass}>
          First
        </button>
        <button type="button" onClick={() => onPageChange(safePage - 1)} disabled={firstDisabled} className={buttonClass}>
          Prev
        </button>
        <label className="flex items-center gap-1 text-xs text-neutral-600">
          <span>Page</span>
          <input
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitPage();
            }}
            className="w-16 rounded-md border border-line px-2 py-1.5 text-center text-xs"
            inputMode="numeric"
            aria-label="Page number"
          />
        </label>
        <button type="button" onClick={() => commitPage()} className={buttonClass}>
          Go
        </button>
        <button type="button" onClick={() => onPageChange(safePage + 1)} disabled={lastDisabled} className={buttonClass}>
          Next
        </button>
        <button type="button" onClick={() => onPageChange(totalPages)} disabled={lastDisabled} className={buttonClass}>
          Last
        </button>
      </div>
    </div>
  );
}
