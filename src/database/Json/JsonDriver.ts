// src/database/JsonDriver.ts
import path from "path";
import type { DatabaseDriver, DatabaseAdapter } from "../types.js";
import { JsonDbAdapter } from "./JsonDbAdapter.js";

export class JsonDriver implements DatabaseDriver {
    private baseDir: string;

    constructor(directory: string = "./data") {
        this.baseDir = directory;
    }

    getAdapter(resourceName: string): DatabaseAdapter {
        const filePath = path.join(this.baseDir, `${resourceName}.json`);
        return new JsonDbAdapter(filePath);
    }
}
