export function paginationFromQuery(query: Record<string, unknown>) {
  const page = Math.min(100000, Math.max(1, Math.floor(Number(query.page)) || 1));
  const limit = Math.min(100, Math.max(1, Math.floor(Number(query.limit)) || 10));
  return { page, limit, skip: (page - 1) * limit };
}

export function pageMeta(page: number, limit: number, total: number) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    page,
    limit,
    total,
    // `pages` remains for existing clients while every new client can use the
    // explicit standard pagination names.
    pages: totalPages,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}
