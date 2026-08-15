export interface BaseRecord {
    id: string;
    createdAt: string;
    updatedAt: string;
    [key: string]: any;
}

export interface QueryOptions {
    filter?: Record<string, any>;
    sort?: Record<string, 1 | -1>;
    limit?: number;
    skip?: number;
}

export interface DatabaseAdapter<T extends BaseRecord = BaseRecord> {
    find(options?: QueryOptions): Promise<T[]>;
    findById(id: string): Promise<T | null>;
    create(data: Omit<T, "id" | "createdAt" | "updatedAt">): Promise<T>;
    update(id: string, data: Partial<T>): Promise<T | null>;
    delete(id: string): Promise<boolean>;
    count(filter?: Record<string, any>): Promise<number>;
}

export interface DatabaseDriver {
    getAdapter(
        resourceName: string,
        customModelOrSchema?: any,
    ): DatabaseAdapter;
    connect?(): Promise<void>;
    disconnect?(): Promise<void>;
}
