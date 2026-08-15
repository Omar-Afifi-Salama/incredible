import type { DatabaseAdapter } from "../database/types.js";
import type {
    RouteMiddleware,
    SchemaValidator,
} from "../router/createResourceRouter.js";

export interface ResourceDefinition<T = any> {
    schema?: SchemaValidator;
    adapter?: DatabaseAdapter; // Optional adapter override specifically for this resource
    middleware?: RouteMiddleware;
}

export function defineResource<T = any>(
    config: ResourceDefinition<T> = {},
): ResourceDefinition<T> {
    return config;
}
