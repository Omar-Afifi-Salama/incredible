import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { z } from "zod";
import swaggerUi from "swagger-ui-express";
import { generateOpenApiSpec } from "../src/docs/openapiGenerator.js";

describe("OpenAPI / Swagger Generation", () => {
    const sampleProductSchema = z.object({
        name: z.string().min(2),
        price: z.number().positive(),
        category: z.string(),
        inStock: z.boolean().default(true),
    });

    const sampleArticleSchema = z.object({
        title: z.string().min(5),
        content: z.string(),
        status: z.enum(["draft", "published"]).default("draft"),
    });

    describe("generateOpenApiSpec", () => {
        it("should generate a valid OpenAPI 3.0.0 root object with info and prefix", () => {
            const spec = generateOpenApiSpec({
                title: "Test Store API",
                version: "2.0.0",
                description: "Custom description",
                apiPrefix: "/v1",
                resources: {},
                authEnabled: false,
            });

            expect(spec.openapi).toBe("3.0.0");
            expect(spec.info.title).toBe("Test Store API");
            expect(spec.info.version).toBe("2.0.0");
            expect(spec.info.description).toBe("Custom description");
            expect(spec.components.schemas.PaginationMeta).toBeDefined();
            expect(spec.components.schemas.ApiError).toBeDefined();
        });

        it("should generate REST paths and JSON schemas for defined resources", () => {
            const spec = generateOpenApiSpec({
                apiPrefix: "/api",
                resources: {
                    products: { schema: sampleProductSchema },
                    articles: { schema: sampleArticleSchema },
                },
                authEnabled: false,
            });

            // Check paths existence
            expect(spec.paths["/api/products"]).toBeDefined();
            expect(spec.paths["/api/products/{id}"]).toBeDefined();
            expect(spec.paths["/api/articles"]).toBeDefined();
            expect(spec.paths["/api/articles/{id}"]).toBeDefined();

            // Check operations on collection
            expect(spec.paths["/api/products"].get).toBeDefined();
            expect(spec.paths["/api/products"].post).toBeDefined();

            // Check operations on item
            expect(spec.paths["/api/products/{id}"].get).toBeDefined();
            expect(spec.paths["/api/products/{id}"].patch).toBeDefined();
            expect(spec.paths["/api/products/{id}"].delete).toBeDefined();

            // Check converted Zod Schemas
            const productSchema = spec.components.schemas.ProductsItem;
            expect(productSchema).toBeDefined();
            expect(productSchema.properties.name).toBeDefined();
            expect(productSchema.properties.price).toBeDefined();
            expect(productSchema.properties.id).toBeDefined();
        });

        it("should include auth paths and security schemes when auth is enabled", () => {
            const spec = generateOpenApiSpec({
                apiPrefix: "/api",
                resources: {},
                authEnabled: true,
            });

            expect(spec.paths["/api/auth/register"]).toBeDefined();
            expect(spec.paths["/api/auth/login"]).toBeDefined();
            expect(spec.paths["/api/auth/me"]).toBeDefined();

            expect(spec.components.securitySchemes.bearerAuth).toBeDefined();
            expect(spec.components.securitySchemes.cookieAuth).toBeDefined();
        });

        it("should handle resources without a schema gracefully", () => {
            const spec = generateOpenApiSpec({
                apiPrefix: "/api",
                resources: {
                    logs: {},
                },
                authEnabled: false,
            });

            expect(spec.paths["/api/logs"]).toBeDefined();
            expect(spec.components.schemas.LogsItem).toEqual({
                type: "object",
                additionalProperties: true,
            });
        });
    });

    // ----------------------------------------------------
    // Express Route Serving Tests
    // ----------------------------------------------------
    describe("Swagger UI Endpoints", () => {
        let app: express.Express;

        beforeEach(() => {
            app = express();
            app.use(express.json());

            const spec = generateOpenApiSpec({
                apiPrefix: "/api",
                resources: {
                    products: { schema: sampleProductSchema },
                },
                authEnabled: true,
            });

            // 1. JSON endpoint
            app.get("/api/docs/openapi.json", (_req, res) => {
                res.setHeader("Content-Type", "application/json");
                res.send(spec);
            });

            // 2. Swagger UI endpoint
            app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(spec));
        });

        it("should serve the raw openapi.json file", async () => {
            const res = await request(app).get("/api/docs/openapi.json");

            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toContain("application/json");
            expect(res.body.openapi).toBe("3.0.0");
            expect(res.body.paths["/api/products"]).toBeDefined();
        });

        it("should serve the Swagger UI HTML dashboard", async () => {
            const res = await request(app).get("/api/docs/");

            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toContain("text/html");
            expect(res.text).toContain("Swagger UI");
        });
    });
});
