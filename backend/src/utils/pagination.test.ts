import { describe, expect, it } from "vitest";
import { pageMeta, paginationFromQuery } from "./pagination.js";

describe("pagination", () => {
  it("defaults to ten records and caps untrusted limits", () => {
    expect(paginationFromQuery({})).toEqual({ page: 1, limit: 10, skip: 0 });
    expect(paginationFromQuery({ page: "3", limit: "1000" })).toEqual({
      page: 3,
      limit: 100,
      skip: 200,
    });
  });

  it("returns explicit navigation metadata while preserving pages", () => {
    expect(pageMeta(2, 10, 26)).toEqual({
      page: 2,
      limit: 10,
      total: 26,
      pages: 3,
      totalPages: 3,
      hasNextPage: true,
      hasPrevPage: true,
    });
  });
});
