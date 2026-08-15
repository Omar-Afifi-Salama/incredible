import type { DatabaseAdapter } from "../database/types.js";
import type {
    RouteMiddleware,
    SchemaValidator,
    ResourceHooks,
} from "../router/createResourceRouter.js";

export interface ResourceDefinition<T = any> {
    schema?: SchemaValidator;
    adapter?: DatabaseAdapter; // Optional adapter override specifically for this resource
    middleware?: RouteMiddleware;
    hooks?: ResourceHooks<T>;
}

export function defineResource<T = any>(
    options: ResourceDefinition<T> = {},
): ResourceDefinition<T> {
    return options;
}
