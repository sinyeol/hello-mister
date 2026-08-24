import { useMemo, useState } from 'react';
import { CheckCircle2, FileText, Printer, Star, Trash2, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@sticker-v1/components/common/PageHeader';
import { parseCsvGames } from '@sticker-v1/services/import/parseCsvGames';
import { parseTextGames, rowsToGameEntries, type ParsedGameRow } from '@sticker-v1/services/import/parseTextGames';
import { useProjectStore } from '@sticker-v1/store/projectStore';

type SortField = 'title' | 'category' | 'generated' | 'favorite';
type StateFilter = 'all' | 'yes' | 'no';

export function GameImportPage() {
  const { categories, games, cards, savedCards, setGames, setPrintQueue } = useProjectStore();
  const navigate = useNavigate();
  const defaultCategoryId = categories[0]?.id ?? '';
  const [textInput, setTextInput] = useState('Metal Slug\nR-Type\nCastlevania: Symphony of the Night');
  const [rows, setRows] = useState<ParsedGameRow[]>(
    games.map((game) => ({
      id: game.id,
      title: game.title,
      categoryId: game.categoryId,
      source: 'SAMPLE',
      errors: [],
    })),
  );
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [sortField, setSortField] = useState<SortField>('title');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [generatedFilter, setGeneratedFilter] = useState<StateFilter>('all');
  const [favoriteFilter, setFavoriteFilter] = useState<StateFilter>('all');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const categoriesById = Object.fromEntries(categories.map((category) => [category.id, category]));
  const savedCardByGameId = useMemo(() => {
    const map = new Map<string, (typeof savedCards)[number]>();
    savedCards.forEach((record) => {
      if (!map.has(record.card.gameId)) map.set(record.card.gameId, record);
    });
    return map;
  }, [savedCards]);

  const enrichedRows = useMemo(
    () =>
      rows.map((row) => {
        const generatedCard = cards.find((card) => card.gameId === row.id && !card.deleted);
        const savedCard = savedCardByGameId.get(row.id);
        return {
          ...row,
          generated: Boolean(generatedCard || savedCard),
          favorite: Boolean(savedCard?.favorite),
          savedCardId: savedCard?.id,
          categoryName: categoriesById[row.categoryId]?.displayName ?? '',
        };
      }),
    [cards, categoriesById, rows, savedCardByGameId],
  );

  const visibleRows = useMemo(() => {
    const filtered = enrichedRows.filter((row) => {
      if (categoryFilter !== 'all' && row.categoryId !== categoryFilter) return false;
      if (generatedFilter !== 'all' && row.generated !== (generatedFilter === 'yes')) return false;
      if (favoriteFilter !== 'all' && row.favorite !== (favoriteFilter === 'yes')) return false;
      return true;
    });
    return [...filtered].sort((a, b) => {
      const direction = sortDirection === 'asc' ? 1 : -1;
      if (sortField === 'category') return a.categoryName.localeCompare(b.categoryName) * direction;
      if (sortField === 'generated') return (Number(a.generated) - Number(b.generated)) * direction;
      if (sortField === 'favorite') return (Number(a.favorite) - Number(b.favorite)) * direction;
      return a.title.localeCompare(b.title) * direction;
    });
  }, [categoryFilter, enrichedRows, favoriteFilter, generatedFilter, sortDirection, sortField]);

  const invalidCount = useMemo(() => rows.filter((row) => row.errors.length > 0 || !row.title.trim()).length, [rows]);

  function commitRows(nextRows: ParsedGameRow[]) {
    setRows(nextRows);
    setGames(rowsToGameEntries(nextRows));
    setSelectedRowIds((current) => current.filter((id) => nextRows.some((row) => row.id === id)));
  }

  function parseText() {
    commitRows(parseTextGames(textInput, defaultCategoryId));
    setFeedback({ type: 'success', message: 'Text rows parsed and saved.' });
  }

  async function importFile(file: File) {
    const content = await file.text();
    if (file.name.toLowerCase().endsWith('.csv')) {
      commitRows(parseCsvGames(content, categories, defaultCategoryId));
      setFeedback({ type: 'success', message: 'CSV imported and saved.' });
      return;
    }
    commitRows(parseTextGames(content, defaultCategoryId).map((row) => ({ ...row, source: 'TXT' })));
    setFeedback({ type: 'success', message: 'TXT imported and saved.' });
  }

  function updateRow(rowId: string, patch: Partial<ParsedGameRow>) {
    commitRows(rows.map((row) => (row.id === rowId ? { ...row, ...patch, errors: validateRow({ ...row, ...patch }) } : row)));
  }

  function validateRow(row: ParsedGameRow) {
    const errors: string[] = [];
    if (!row.title.trim()) errors.push('Title is required.');
    if (!row.categoryId) errors.push('Category is required.');
    return errors;
  }

  function toggleSelected(rowId: string) {
    setSelectedRowIds((current) =>
      current.includes(rowId) ? current.filter((candidate) => candidate !== rowId) : [...current, rowId],
    );
  }

  function sendSelectedToPrint() {
    const selectedRows = selectedRowIds.map((id) => enrichedRows.find((row) => row.id === id)).filter(Boolean);
    const savedIds = selectedRows.map((row) => row?.savedCardId).filter((id): id is string => Boolean(id));
    const missingCount = selectedRows.length - savedIds.length;
    if (savedIds.length === 0) {
      setFeedback({ type: 'error', message: 'Selected games do not have saved cards yet. Save cards before sending to print.' });
      return;
    }
    setPrintQueue(savedIds);
    if (missingCount > 0) {
      setFeedback({ type: 'error', message: `${savedIds.length} saved card(s) sent. ${missingCount} selected game(s) need saved cards first.` });
      return;
    }
    navigate('/stickers/output');
  }

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortField(field);
    setSortDirection('asc');
  }

  return (
    <>
      <PageHeader
        eyebrow="Input"
        title="Game List Import"
        description="줄 단위 텍스트, TXT, CSV(title, category)를 GameEntry 상태로 정규화하고 관리합니다."
      />

      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <section className="rounded-lg border border-line bg-white p-5 shadow-surface">
          {feedback && (
            <div
              className={`mb-4 rounded-md border px-3 py-2 text-sm ${
                feedback.type === 'success'
                  ? 'border-green-200 bg-green-50 text-green-800'
                  : 'border-red-200 bg-red-50 text-red-700'
              }`}
            >
              {feedback.message}
            </div>
          )}
          <label className="block">
            <span className="text-sm font-medium">Paste titles, one per line</span>
            <textarea
              value={textInput}
              onChange={(event) => setTextInput(event.target.value)}
              className="mt-2 min-h-48 w-full rounded-md border border-line px-3 py-2 text-sm"
            />
          </label>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={parseText}
              className="inline-flex items-center gap-2 rounded-md bg-ink px-3 py-2 text-sm font-medium text-white"
            >
              <FileText className="h-4 w-4" />
              Parse Text
            </button>

            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium">
              <Upload className="h-4 w-4" />
              Import TXT / CSV
              <input
                type="file"
                accept=".txt,.csv,text/plain,text/csv"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importFile(file);
                  event.currentTarget.value = '';
                }}
              />
            </label>
          </div>
        </section>

        <section className="rounded-lg border border-line bg-white p-5 shadow-surface">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold">Managed game rows</h3>
              <p className="text-sm text-neutral-500">
                {rows.length} rows, {invalidCount} invalid, {selectedRowIds.length} selected
              </p>
            </div>
            <button
              type="button"
              onClick={sendSelectedToPrint}
              disabled={selectedRowIds.length === 0}
              className="inline-flex items-center gap-2 rounded-md bg-ink px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              <Printer className="h-4 w-4" />
              Send selected to print
            </button>
          </div>

          <div className="mb-4 grid gap-3 md:grid-cols-4">
            <label className="text-sm">
              <span className="font-medium">Category</span>
              <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="mt-1 w-full rounded-md border border-line px-2 py-2">
                <option value="all">All</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.displayName}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="font-medium">Generated</span>
              <select value={generatedFilter} onChange={(event) => setGeneratedFilter(event.target.value as StateFilter)} className="mt-1 w-full rounded-md border border-line px-2 py-2">
                <option value="all">All</option>
                <option value="yes">Generated</option>
                <option value="no">Not generated</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="font-medium">Favorite</span>
              <select value={favoriteFilter} onChange={(event) => setFavoriteFilter(event.target.value as StateFilter)} className="mt-1 w-full rounded-md border border-line px-2 py-2">
                <option value="all">All</option>
                <option value="yes">Favorite</option>
                <option value="no">Not favorite</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="font-medium">Sort direction</span>
              <select value={sortDirection} onChange={(event) => setSortDirection(event.target.value as 'asc' | 'desc')} className="mt-1 w-full rounded-md border border-line px-2 py-2">
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </label>
          </div>

          <div className="overflow-auto">
            <table className="min-w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-neutral-500">
                  <th className="border-b border-line px-2 py-2">
                    <input
                      type="checkbox"
                      checked={visibleRows.length > 0 && visibleRows.every((row) => selectedRowIds.includes(row.id))}
                      onChange={(event) =>
                        setSelectedRowIds((current) =>
                          event.target.checked
                            ? Array.from(new Set([...current, ...visibleRows.map((row) => row.id)]))
                            : current.filter((id) => !visibleRows.some((row) => row.id === id)),
                        )
                      }
                    />
                  </th>
                  <th className="border-b border-line px-2 py-2"><button type="button" onClick={() => toggleSort('title')}>Title</button></th>
                  <th className="border-b border-line px-2 py-2"><button type="button" onClick={() => toggleSort('category')}>Category</button></th>
                  <th className="border-b border-line px-2 py-2">Source</th>
                  <th className="border-b border-line px-2 py-2"><button type="button" onClick={() => toggleSort('generated')}>Generated</button></th>
                  <th className="border-b border-line px-2 py-2"><button type="button" onClick={() => toggleSort('favorite')}>Favorite</button></th>
                  <th className="border-b border-line px-2 py-2">Status</th>
                  <th className="border-b border-line px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.id} className={selectedRowIds.includes(row.id) ? 'bg-neutral-50' : undefined}>
                    <td className="border-b border-line px-2 py-2">
                      <input type="checkbox" checked={selectedRowIds.includes(row.id)} onChange={() => toggleSelected(row.id)} />
                    </td>
                    <td className="border-b border-line px-2 py-2">
                      <input
                        value={row.title}
                        onChange={(event) => updateRow(row.id, { title: event.target.value })}
                        className="w-full min-w-52 rounded-md border border-line px-2 py-1"
                      />
                    </td>
                    <td className="border-b border-line px-2 py-2">
                      <select
                        value={row.categoryId}
                        onChange={(event) => updateRow(row.id, { categoryId: event.target.value })}
                        className="w-full min-w-40 rounded-md border border-line px-2 py-1"
                      >
                        {categories.map((category) => (
                          <option key={category.id} value={category.id}>{category.displayName}</option>
                        ))}
                      </select>
                    </td>
                    <td className="border-b border-line px-2 py-2">{row.source}</td>
                    <td className="border-b border-line px-2 py-2">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${row.generated ? 'bg-green-50 text-green-700' : 'bg-neutral-100 text-neutral-600'}`}>
                        {row.generated && <CheckCircle2 className="h-3 w-3" />}
                        {row.generated ? 'Generated' : 'Missing'}
                      </span>
                    </td>
                    <td className="border-b border-line px-2 py-2">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${row.favorite ? 'bg-amber-50 text-amber-700' : 'bg-neutral-100 text-neutral-600'}`}>
                        {row.favorite && <Star className="h-3 w-3 fill-current" />}
                        {row.favorite ? 'Favorite' : 'No'}
                      </span>
                    </td>
                    <td className="border-b border-line px-2 py-2">
                      {row.errors.length > 0 ? <span className="text-red-700">{row.errors.join(' ')}</span> : <span className="text-green-700">Ready</span>}
                    </td>
                    <td className="border-b border-line px-2 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => commitRows(rows.filter((candidate) => candidate.id !== row.id))}
                        className="rounded-md border border-line p-2 text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
