export function pageCountFor(totalItems: number, pageSize: number) {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(Math.max(0, totalItems) / pageSize));
}

export function clampPage(page: number, totalPages: number) {
  if (!Number.isFinite(page)) return 1;
  return Math.max(1, Math.min(Math.max(1, totalPages), Math.floor(page)));
}

export function paginateItems<T>(items: T[], page: number, pageSize: number) {
  const totalPages = pageCountFor(items.length, pageSize);
  const currentPage = clampPage(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  return {
    currentPage,
    totalPages,
    totalItems: items.length,
    items: items.slice(start, start + pageSize),
  };
}
