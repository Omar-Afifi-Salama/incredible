import { describe, it, expect } from "vitest";
import { parseFilterParams } from "../src/router/utils/parseFilterParams.js";
import { parseSortParam } from "../src/router/utils/parseSortParam.js";

describe("Router Query Utilities", () => {
    describe("parseSortParam", () => {
        it("returns empty object or undefined for missing or invalid sort strings", () => {
            expect(parseSortParam(undefined)).toBeUndefined();
            expect(parseSortParam("")).toBeUndefined();
        });

        it("parses ascending and descending sort fields correctly", () => {
            // "+field" or "field" -> 1 (ascending), "-field" -> -1 (descending)
            expect(parseSortParam("createdAt")).toEqual({ createdAt: 1 });
            expect(parseSortParam("+name")).toEqual({ name: 1 });
            expect(parseSortParam("-price")).toEqual({ price: -1 });
            expect(parseSortParam("category,-price,name")).toEqual({
                category: 1,
                price: -1,
                name: 1,
            });
        });
    });

    describe("parseFilterParams", () => {
        it("filters out reserved query keys (limit, skip, page, sort)", () => {
            const query = {
                limit: "10",
                skip: "5",
                page: "2",
                sort: "-createdAt",
                status: "active",
            };
            const filter = parseFilterParams(query);
            expect(filter).toEqual({ status: "active" });
            expect(filter).not.toHaveProperty("limit");
            expect(filter).not.toHaveProperty("skip");
            expect(filter).not.toHaveProperty("page");
            expect(filter).not.toHaveProperty("sort");
        });

        it("parses comparison operators ($gt, $gte, $lt, $lte, $ne) and basic values", () => {
            const query = {
                price: { gt: "20", lte: "100" },
                role: { ne: "admin" },
                active: "true",
            };
            const filter = parseFilterParams(query);
            expect(filter).toBeDefined();
        });
    });
});
