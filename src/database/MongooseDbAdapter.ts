import { Model } from "mongoose";
import type { BaseRecord, DatabaseAdapter, QueryOptions } from "./types.js";

export class MongooseDbAdapter<
    T extends BaseRecord = BaseRecord,
> implements DatabaseAdapter<T> {
    private model: Model<any>;

    constructor(model: Model<any>) {
        this.model = model;
    }

    /**
     * Normalizes MongoDB documents into BaseRecord format:
     * - Maps `_id` to string `id`
     * - Ensures ISO timestamps for `createdAt` and `updatedAt` if present
     */
    private formatDoc(doc: any): T {
        if (!doc) return doc;
        const obj =
            typeof doc.toObject === "function" ? doc.toObject() : { ...doc };

        const { _id, __v, ...rest } = obj;

        return {
            ...rest,
            id: _id ? _id.toString() : obj.id,
            createdAt: obj.createdAt
                ? new Date(obj.createdAt).toISOString()
                : obj.createdAt,
            updatedAt: obj.updatedAt
                ? new Date(obj.updatedAt).toISOString()
                : obj.updatedAt,
        } as unknown as T;
    }

    async find(options: QueryOptions = {}): Promise<T[]> {
        const filter = options.filter || {};
        let query = this.model.find(filter);

        if (options.sort) {
            query = query.sort(options.sort);
        }

        if (options.skip !== undefined) {
            query = query.skip(options.skip);
        }

        if (options.limit !== undefined) {
            query = query.limit(options.limit);
        }

        const records = await query.lean().exec();
        return records.map((doc: any) => this.formatDoc(doc));
    }

    async findById(id: string): Promise<T | null> {
        try {
            const doc = await this.model.findById(id).lean().exec();
            if (!doc) return null;
            return this.formatDoc(doc);
        } catch {
            return null;
        }
    }

    async create(data: Omit<T, "id" | "createdAt" | "updatedAt">): Promise<T> {
        const created = await this.model.create(data);
        return this.formatDoc(created);
    }

    async update(id: string, data: Partial<T>): Promise<T | null> {
        try {
            const { id: _, _id: __, ...updatePayload } = data as any;

            const updated = await this.model
                .findByIdAndUpdate(
                    id,
                    { $set: updatePayload },
                    { returnDocument: "after", runValidators: true },
                )
                .lean()
                .exec();

            if (!updated) return null;
            return this.formatDoc(updated);
        } catch {
            return null;
        }
    }

    async delete(id: string): Promise<boolean> {
        try {
            const deleted = await this.model.findByIdAndDelete(id).exec();
            return deleted !== null;
        } catch {
            return false;
        }
    }

    async count(filter: Record<string, any> = {}): Promise<number> {
        return this.model.countDocuments(filter).exec();
    }
}
