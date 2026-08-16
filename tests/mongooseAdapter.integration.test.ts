import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose, { Schema } from "mongoose";
import {
    MongooseDbAdapter,
    MongooseDriver,
} from "../src/database/Mongo/index.js";

describe("MongooseDbAdapter & Driver Integration", () => {
    let mongoServer: MongoMemoryServer;
    let driver: MongooseDriver;
    let adapter: MongooseDbAdapter;

    const ItemSchema = new Schema(
        { name: { type: String, required: true }, count: Number },
        { timestamps: true },
    );
    const ItemModel =
        mongoose.models.Item || mongoose.model("Item", ItemSchema);

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        const uri = mongoServer.getUri();
        driver = new MongooseDriver(uri);
        await driver.connect();
    });

    afterAll(async () => {
        await mongoose.disconnect();
        await mongoServer.stop();
    });

    beforeEach(async () => {
        await ItemModel.deleteMany({});
        adapter = driver.getAdapter("Item", ItemModel) as MongooseDbAdapter;
    });

    it("creates and normalizes documents (_id to id)", async () => {
        const item = await adapter.create({ name: "Mongo Item", count: 10 });
        expect(item.id).toBeDefined();
        expect(item.name).toBe("Mongo Item");
        expect(item.createdAt).toBeDefined();
    });

    it("finds documents by ID and handles invalid ObjectId cleanly", async () => {
        const item = await adapter.create({ name: "Search Target" });
        const found = await adapter.findById(item.id);
        expect(found?.name).toBe("Search Target");

        const invalid = await adapter.findById("invalid-id-format");
        expect(invalid).toBeNull();
    });

    it("updates documents", async () => {
        const item = await adapter.create({ name: "Before Update" });
        const updated = await adapter.update(item.id, { name: "After Update" });
        expect(updated?.name).toBe("After Update");

        const failedUpdate = await adapter.update("invalid-id", {
            name: "Fail",
        });
        expect(failedUpdate).toBeNull();
    });

    it("deletes documents and returns boolean", async () => {
        const item = await adapter.create({ name: "To Remove" });
        const result = await adapter.delete(item.id);
        expect(result).toBe(true);

        const falseResult = await adapter.delete("invalid-id");
        expect(falseResult).toBe(false);
    });

    it("counts and filters documents", async () => {
        await adapter.create({ name: "A", count: 1 });
        await adapter.create({ name: "B", count: 2 });

        const total = await adapter.count();
        expect(total).toBe(2);

        const filtered = await adapter.find({ filter: { name: "A" } });
        expect(filtered.length).toBe(1);
    });
});
