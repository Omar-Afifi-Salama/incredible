import type { Router } from "express";
import type passport from "passport";
import type { BaseRecord, DatabaseAdapter } from "../database/types.js";
import type { SchemaValidator } from "../router/createResourceRouter.js";

export interface BaseUserRecord extends BaseRecord {
    id: string;
    username: string;
    password?: string;
    role?: string;
    [key: string]: any;
}

export type SafeUser<T extends BaseUserRecord = BaseUserRecord> = Omit<
    T,
    "password"
>;

export interface OAuthProviderConfig {
    name: string;
    scope?: string[];
    successRedirect?: string;
    failureRedirect?: string;
}

export interface AuthConfig {
    jwtSecret?: string;
    sessionSecret?: string;
    userAdapter?: DatabaseAdapter<BaseUserRecord>;
    registrationSchema?: SchemaValidator;
    providers?: OAuthProviderConfig[];
    setupStrategies?: (
        passportInstance: typeof passport,
        userAdapter: DatabaseAdapter<BaseUserRecord>,
    ) => void;
    customRoutes?: (
        router: Router,
        context: {
            userAdapter: DatabaseAdapter<BaseUserRecord>;
            jwtSecret: string;
        },
    ) => void;
}

// Global Declaration Merging for Express & Passport
declare global {
    namespace Express {
        // Defines req.user for both Session and JWT contexts
        interface User extends BaseUserRecord {}
    }
}
