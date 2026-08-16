import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import type { BaseRecord, DatabaseAdapter, QueryOptions } from "../types.js";

export class JsonDbAdapter<
    T extends BaseRecord = BaseRecord,
> implements DatabaseAdapter<T> {
    private filePath: string;
    private isInitialized = false;
    // Mutex promise queue to serialize write operations safely
    private writeQueue: Promise<any> = Promise.resolve();

    constructor(filePath: string) {
        this.filePath = path.resolve(filePath);
    }

    /**
     * Ensures the file and parent directory exist before any I/O operation
     */
    private async init(): Promise<void> {
        if (this.isInitialized) return;

        const dir = path.dirname(this.filePath);
        await fs.mkdir(dir, { recursive: true });

        try {
            await fs.access(this.filePath);
        } catch {
            // File does not exist, initialize with empty array
            await fs.writeFile(
                this.filePath,
                JSON.stringify([], null, 2),
                "utf-8",
            );
        }

        this.isInitialized = true;
    }

    /**
     * Reads and parses data from disk
     */
    private async readData(): Promise<T[]> {
        await this.init();
        try {
            const raw = await fs.readFile(this.filePath, "utf-8");
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    /**
     * Serializes write operations through a promise chain to avoid race conditions
     */
    private async writeData(data: T[]): Promise<void> {
        await this.init();

        // Chain write operations sequentially
        this.writeQueue = this.writeQueue.then(async () => {
            const tempPath = `${this.filePath}.${crypto.randomBytes(4).toString("hex")}.tmp`;
            // Write to a temporary file first, then atomically rename to prevent corrupted writes
            await fs.writeFile(
                tempPath,
                JSON.stringify(data, null, 2),
                "utf-8",
            );
            await fs.rename(tempPath, this.filePath);
        });

        return this.writeQueue;
    }

    /**
     * Evaluates simple filter conditions including exact match and comparison operators
     */
    private matchesFilter(item: T, filter?: Record<string, any>): boolean {
        if (!filter || Object.keys(filter).length === 0) return true;

        return Object.entries(filter).every(([key, condition]) => {
            const val = item[key];

            if (typeof condition === "object" && condition !== null) {
                if ("$gte" in condition && !(val >= condition.$gte))
                    return false;
                if ("$lte" in condition && !(val <= condition.$lte))
                    return false;
                if ("$gt" in condition && !(val > condition.$gt)) return false;
                if ("$lt" in condition && !(val < condition.$lt)) return false;
                if ("$ne" in condition && val === condition.$ne) return false;
                return true;
            }

            return val === condition;
        });
    }

    // --- Core Adapter Methods ---

    async find(options: QueryOptions = {}): Promise<T[]> {
        const data = await this.readData();
        let results = data.filter((item) =>
            this.matchesFilter(item, options.filter),
        );

        // Handle sorting
        if (options.sort) {
            const [sortField, sortDir] = Object.entries(options.sort)[0] || [];
            if (sortField) {
                results.sort((a, b) => {
                    const aVal = a[sortField];
                    const bVal = b[sortField];
                    if (aVal < bVal) return sortDir === 1 ? -1 : 1;
                    if (aVal > bVal) return sortDir === 1 ? 1 : -1;
                    return 0;
                });
            }
        }

        // Handle pagination (skip & limit)
        const skip = options.skip ?? 0;
        const limit = options.limit ?? results.length;

        return results.slice(skip, skip + limit);
    }

    async findById(id: string): Promise<T | null> {
        const data = await this.readData();
        return data.find((item) => item.id === id) || null;
    }

    async create(data: Omit<T, "id" | "createdAt" | "updatedAt">): Promise<T> {
        const records = await this.readData();
        const now = new Date().toISOString();

        const newRecord: T = {
            ...data,
            id: crypto.randomUUID(),
            createdAt: now,
            updatedAt: now,
        } as unknown as T;

        records.push(newRecord);
        await this.writeData(records);

        return newRecord;
    }

    async update(id: string, data: Partial<T>): Promise<T | null> {
        const records = await this.readData();
        const index = records.findIndex((item) => item.id === id);

        if (index === -1) return null;

        const updatedRecord: T = {
            ...records[index],
            ...data,
            id: records[index]?.id, // Prevent overriding immutable ID
            createdAt: records[index]?.createdAt, // Preserve creation timestamp
            updatedAt: new Date().toISOString(),
        } as unknown as T;

        records[index] = updatedRecord;
        await this.writeData(records);

        return updatedRecord;
    }

    async delete(id: string): Promise<boolean> {
        const records = await this.readData();
        const filtered = records.filter((item) => item.id !== id);

        if (filtered.length === records.length) {
            return false; // Item didn't exist
        }

        await this.writeData(filtered);
        return true;
    }

    async count(filter?: Record<string, any>): Promise<number> {
        const data = await this.readData();
        if (!filter || Object.keys(filter).length === 0) return data.length;
        return data.filter((item) => this.matchesFilter(item, filter)).length;
    }
}
