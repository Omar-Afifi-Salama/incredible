import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "fs/promises";
import path from "path";
import { JsonDbAdapter } from "../src/database/Json/index.js";

const TEST_DIR = path.join(__dirname, "adapter-test-data");
const FILE_PATH = path.join(TEST_DIR, "items.json");

describe("JsonDbAdapter Unit Tests", () => {
    let adapter: JsonDbAdapter;

    beforeEach(async () => {
        await fs.rm(TEST_DIR, { recursive: true, force: true });
        await fs.mkdir(TEST_DIR, { recursive: true });
        adapter = new JsonDbAdapter(FILE_PATH);
    });

    afterAll(async () => {
        await fs.rm(TEST_DIR, { recursive: true, force: true });
    });

    it("creates records with auto-generated id, createdAt, and updatedAt", async () => {
        const item = await adapter.create({ name: "First Item", price: 50 });

        expect(item.id).toBeDefined();
        expect(typeof item.id).toBe("string");
        expect(item.createdAt).toBeDefined();
        expect(item.updatedAt).toBeDefined();
        expect(item.name).toBe("First Item");
    });

    it("finds records by ID and returns null for non-existent IDs", async () => {
        const created = await adapter.create({ name: "Target Item" });

        const found = await adapter.findById(created.id);
        expect(found).not.toBeNull();
        expect(found?.name).toBe("Target Item");

        const notFound = await adapter.findById("non-existent-id");
        expect(notFound).toBeNull();
    });

    it("updates records and refreshes updatedAt", async () => {
        const created = await adapter.create({ name: "Old Name", score: 10 });

        // Brief sleep to guarantee timestamp difference
        await new Promise((resolve) => setTimeout(resolve, 5));

        const updated = await adapter.update(created.id, { name: "New Name" });
        expect(updated).not.toBeNull();
        expect(updated?.name).toBe("New Name");
        expect(updated?.score).toBe(10); // Preserves unchanged fields
        expect(updated?.updatedAt).not.toBe(created.updatedAt);
    });

    it("deletes records and returns boolean status", async () => {
        const created = await adapter.create({ name: "Delete Me" });

        const deleteSuccess = await adapter.delete(created.id);
        expect(deleteSuccess).toBe(true);

        const check = await adapter.findById(created.id);
        expect(check).toBeNull();

        const deleteNonExistent = await adapter.delete("fake-id");
        expect(deleteNonExistent).toBe(false);
    });

    it("filters and sorts records accurately", async () => {
        await adapter.create({ category: "books", price: 20 });
        await adapter.create({ category: "electronics", price: 100 });
        await adapter.create({ category: "books", price: 50 });

        // Filter
        const books = await adapter.find({ filter: { category: "books" } });
        expect(books.length).toBe(2);

        // Sort descending
        const sortedBooks = await adapter.find({
            filter: { category: "books" },
            sort: { price: -1 },
        });
        expect(sortedBooks[0].price).toBe(50);
        expect(sortedBooks[1].price).toBe(20);
    });
});
