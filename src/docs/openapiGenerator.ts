import { zodToJsonSchema } from "zod-to-json-schema";

export interface OpenApiGeneratorOptions {
    title?: string;
    version?: string;
    description?: string;
    apiPrefix?: string;
    resources: Record<string, { schema?: any; middleware?: any }>;
    authEnabled?: boolean;
}

// Helper to convert Zod v4 schema to OpenAPI JSON schema properties
function convertZodV4ToOpenApi(schema: any): {
    properties: Record<string, any>;
    required: string[];
} {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    // In Zod v4, shape is under schema.def.shape or schema.shape
    const shape = schema?.def?.shape || schema?.shape;
    if (!shape) {
        return { properties, required };
    }

    for (const [key, field] of Object.entries<any>(shape)) {
        let fieldType = field.type;
        let inner = field;

        // Handle default wrappers: e.g. z.boolean().default(true)
        if (fieldType === "default" && field.def?.innerType) {
            inner = field.def.innerType;
            fieldType = inner.type;
        }

        // Handle optional wrappers
        let isOptional = false;
        if (fieldType === "optional" && field.def?.innerType) {
            inner = field.def.innerType;
            fieldType = inner.type;
            isOptional = true;
        }

        const prop: Record<string, any> = {};

        switch (fieldType) {
            case "string":
                prop.type = "string";
                if (typeof inner.minLength === "number")
                    prop.minLength = inner.minLength;
                if (typeof inner.maxLength === "number")
                    prop.maxLength = inner.maxLength;
                if (inner.format) prop.format = inner.format;
                break;

            case "number":
                prop.type = "number";
                if (typeof inner.minValue === "number")
                    prop.minimum = inner.minValue;
                if (typeof inner.maxValue === "number")
                    prop.maximum = inner.maxValue;
                break;

            case "boolean":
                prop.type = "boolean";
                break;

            case "enum":
                prop.type = "string";
                if (inner.def?.values) {
                    prop.enum = inner.def.values;
                } else if (inner.values) {
                    prop.enum = inner.values;
                }
                break;

            case "array":
                prop.type = "array";
                if (inner.def?.element) {
                    prop.items = { type: inner.def.element.type || "string" };
                }
                break;

            default:
                prop.type = fieldType || "string";
                break;
        }

        // Add default value if defined
        if (field.def?.defaultValue !== undefined) {
            prop.default = field.def.defaultValue;
        }

        properties[key] = prop;

        // In Zod, fields are required unless optional or having a default
        if (!isOptional && field.type !== "default") {
            required.push(key);
        }
    }

    return { properties, required };
}

export function generateOpenApiSpec(options: OpenApiGeneratorOptions) {
    const {
        title = "IncredibleJS API",
        version = "1.0.0",
        description = "Auto-generated REST API documentation by IncredibleJS",
        apiPrefix = "/api",
        resources,
        authEnabled = true,
    } = options;

    const paths: Record<string, any> = {};
    const schemas: Record<string, any> = {};

    // Standard Pagination Schema for Swagger Docs
    schemas["PaginationMeta"] = {
        type: "object",
        properties: {
            totalRecords: { type: "integer", example: 42 },
            page: { type: "integer", example: 1 },
            limit: { type: "integer", example: 10 },
            skip: { type: "integer", example: 0 },
            totalPages: { type: "integer", example: 5 },
            hasNextPage: { type: "boolean", example: true },
            hasPrevPage: { type: "boolean", example: false },
        },
    };

    schemas["ApiError"] = {
        type: "object",
        properties: {
            success: { type: "boolean", example: false },
            error: { type: "string", example: "Error message details" },
            details: { type: "array", items: { type: "object" } },
        },
    };

    // 1. Convert Resource Zod Schemas & Build Paths
    for (const [resourceName, config] of Object.entries(resources)) {
        const capitalized =
            resourceName.charAt(0).toUpperCase() + resourceName.slice(1);
        const itemSchemaName = `${capitalized}Item`;

        if (config.schema) {
            const { properties, required } = convertZodV4ToOpenApi(
                config.schema,
            );

            schemas[itemSchemaName] = {
                type: "object",
                required,
                properties: {
                    id: { type: "string", example: "64b8f029c1e0f345a901e23a" },
                    ...properties,
                },
            };
        } else {
            schemas[itemSchemaName] = {
                type: "object",
                additionalProperties: true,
            };
        }

        const basePath = `${apiPrefix}/${resourceName}`;
        const idPath = `${apiPrefix}/${resourceName}/{id}`;

        // Collection Endpoints: GET /api/<resource> and POST /api/<resource>
        paths[basePath] = {
            get: {
                tags: [capitalized],
                summary: `List all ${resourceName}`,
                parameters: [
                    {
                        name: "page",
                        in: "query",
                        schema: { type: "integer", default: 1 },
                        description: "Page number",
                    },
                    {
                        name: "limit",
                        in: "query",
                        schema: { type: "integer", default: 10 },
                        description: "Records per page",
                    },
                    {
                        name: "skip",
                        in: "query",
                        schema: { type: "integer" },
                        description: "Number of records to skip",
                    },
                    {
                        name: "sort",
                        in: "query",
                        schema: { type: "string" },
                        description: "Sort string (e.g. -createdAt,+title)",
                    },
                ],
                responses: {
                    "200": {
                        description: `A paginated or full list of ${resourceName}`,
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: {
                                            type: "boolean",
                                            example: true,
                                        },
                                        pagination: {
                                            $ref: "#/components/schemas/PaginationMeta",
                                        },
                                        data: {
                                            type: "array",
                                            items: {
                                                $ref: `#/components/schemas/${itemSchemaName}`,
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            post: {
                tags: [capitalized],
                summary: `Create a new ${resourceName.slice(0, -1)}`,
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                $ref: `#/components/schemas/${itemSchemaName}`,
                            },
                        },
                    },
                },
                responses: {
                    "201": {
                        description: "Created successfully",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: {
                                            type: "boolean",
                                            example: true,
                                        },
                                        data: {
                                            $ref: `#/components/schemas/${itemSchemaName}`,
                                        },
                                    },
                                },
                            },
                        },
                    },
                    "400": {
                        description: "Validation error",
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: "#/components/schemas/ApiError",
                                },
                            },
                        },
                    },
                },
            },
        };

        // Item Endpoints: GET /:id, PATCH /:id, DELETE /:id
        paths[idPath] = {
            get: {
                tags: [capitalized],
                summary: `Get single ${resourceName.slice(0, -1)} by ID`,
                parameters: [
                    {
                        name: "id",
                        in: "path",
                        required: true,
                        schema: { type: "string" },
                    },
                ],
                responses: {
                    "200": {
                        description: "Found record",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: {
                                            type: "boolean",
                                            example: true,
                                        },
                                        data: {
                                            $ref: `#/components/schemas/${itemSchemaName}`,
                                        },
                                    },
                                },
                            },
                        },
                    },
                    "404": {
                        description: "Record not found",
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: "#/components/schemas/ApiError",
                                },
                            },
                        },
                    },
                },
            },
            patch: {
                tags: [capitalized],
                summary: `Update ${resourceName.slice(0, -1)} by ID`,
                parameters: [
                    {
                        name: "id",
                        in: "path",
                        required: true,
                        schema: { type: "string" },
                    },
                ],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                $ref: `#/components/schemas/${itemSchemaName}`,
                            },
                        },
                    },
                },
                responses: {
                    "200": {
                        description: "Updated successfully",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: {
                                            type: "boolean",
                                            example: true,
                                        },
                                        data: {
                                            $ref: `#/components/schemas/${itemSchemaName}`,
                                        },
                                    },
                                },
                            },
                        },
                    },
                    "404": { description: "Record not found" },
                },
            },
            delete: {
                tags: [capitalized],
                summary: `Delete ${resourceName.slice(0, -1)} by ID`,
                parameters: [
                    {
                        name: "id",
                        in: "path",
                        required: true,
                        schema: { type: "string" },
                    },
                ],
                responses: {
                    "200": {
                        description: "Deleted successfully",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        success: {
                                            type: "boolean",
                                            example: true,
                                        },
                                        message: {
                                            type: "string",
                                            example:
                                                "Record deleted successfully.",
                                        },
                                    },
                                },
                            },
                        },
                    },
                    "404": { description: "Record not found" },
                },
            },
        };
    }

    // 2. Add Auth Routes to Documentation (if Auth is enabled)
    if (authEnabled) {
        paths[`${apiPrefix}/auth/register`] = {
            post: {
                tags: ["Auth"],
                summary: "Register new user account",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["username", "password"],
                                properties: {
                                    username: {
                                        type: "string",
                                        example: "alice",
                                    },
                                    password: {
                                        type: "string",
                                        format: "password",
                                        example: "supersecret123",
                                    },
                                    role: { type: "string", example: "user" },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "201": { description: "Registration successful" },
                    "400": {
                        description: "User already exists or validation failed",
                    },
                },
            },
        };

        paths[`${apiPrefix}/auth/login`] = {
            post: {
                tags: ["Auth"],
                summary: "Log in with username and password",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["username", "password"],
                                properties: {
                                    username: {
                                        type: "string",
                                        example: "alice",
                                    },
                                    password: {
                                        type: "string",
                                        format: "password",
                                        example: "supersecret123",
                                    },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "200": {
                        description:
                            "Login successful with JWT token and session cookie",
                    },
                    "401": { description: "Invalid credentials" },
                },
            },
        };

        paths[`${apiPrefix}/auth/me`] = {
            get: {
                tags: ["Auth"],
                summary: "Get current authenticated user profile",
                security: [{ bearerAuth: [] }, { cookieAuth: [] }],
                responses: {
                    "200": { description: "Authenticated profile" },
                    "401": { description: "Unauthorized" },
                },
            },
        };
    }

    return {
        openapi: "3.0.0",
        info: { title, version, description },
        paths,
        components: {
            schemas,
            securitySchemes: {
                bearerAuth: {
                    type: "http",
                    scheme: "bearer",
                    bearerFormat: "JWT",
                    description: "Enter JWT token in format: Bearer <token>",
                },
                cookieAuth: {
                    type: "apiKey",
                    in: "cookie",
                    name: "connect.sid",
                    description: "Session Cookie authentication",
                },
            },
        },
    };
}
