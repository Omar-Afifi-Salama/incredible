import mongoose, { Model, Schema } from "mongoose";
import type { DatabaseDriver, DatabaseAdapter, BaseRecord } from "./types.js";
import { MongooseDbAdapter } from "./MongooseDbAdapter.js";

export class MongooseDriver implements DatabaseDriver {
    private uri?: string | undefined;

    constructor(uri?: string) {
        this.uri = uri;
    }

    async connect(): Promise<void> {
        // If already connected by the developer elsewhere in their app, do nothing
        if (mongoose.connection.readyState !== 0) {
            return;
        }

        // If not connected and no URI was provided, throw a clear actionable error
        if (!this.uri) {
            throw new Error(
                '[MongooseDriver] MongoDB URI was not provided and no active Mongoose connection was found. Please pass a connection URI: new MongooseDriver("mongodb://...")',
            );
        }

        // TypeScript safely narrows this.uri to string
        await mongoose.connect(this.uri);
    }

    /**
     * Gracefully tears down the active Mongoose connection.
     */
    async disconnect(): Promise<void> {
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }
    }

    getAdapter<T extends BaseRecord = BaseRecord>(
        resourceName: string,
        customModel?: Model<any>,
    ): DatabaseAdapter<T> {
        if (customModel) {
            return new MongooseDbAdapter<T>(customModel);
        }

        // Auto-create model if not explicitly passed
        const capitalized =
            resourceName.charAt(0).toUpperCase() + resourceName.slice(1);
        const model =
            mongoose.models[capitalized] ||
            mongoose.model(
                capitalized,
                new Schema({}, { timestamps: true, strict: false }),
            );

        return new MongooseDbAdapter<T>(model);
    }
}
