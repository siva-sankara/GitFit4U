export function paginationFromQuery(query: Record<string, unknown>) {
  const page = Math.min(100000, Math.max(1, Math.floor(Number(query.page)) || 1));
  const limit = Math.min(100, Math.max(1, Math.floor(Number(query.limit)) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

export function pageMeta(page: number, limit: number, total: number) {
  return { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) };
}
