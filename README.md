# Incredible Framework

<div align="center">

[![NPM Version](https://img.shields.io/npm/v/@omarahm3/incredible?style=for-the-badge&logo=npm&color=CB3837&logoColor=white)](https://www.npmjs.com/package/@omarahm3/incredible)
[![CI Status](https://img.shields.io/github/actions/workflow/status/omarahm3/incredible-framework/ci.yml?branch=main&style=for-the-badge&logo=githubactions&logoColor=white&label=CI)](https://github.com/omarahm3/incredible-framework/actions)
[![Coverage](https://img.shields.io/badge/Coverage-85%2B%25-brightgreen?style=for-the-badge&logo=vitest&logoColor=white)](https://github.com/omarahm3/incredible-framework)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge&logo=open-source-initiative&logoColor=white)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

</div>

<p align="center">
  <img src="https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white" alt="Express" />
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white" alt="MongoDB" />
  <img src="https://img.shields.io/badge/Zod-3E67B1?style=for-the-badge&logo=zod&logoColor=white" alt="Zod" />
  <img src="https://img.shields.io/badge/JWT-000000?style=for-the-badge&logo=jsonwebtokens&logoColor=white" alt="JWT" />
  <img src="https://img.shields.io/badge/Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white" alt="Vitest" />
  <img src="https://img.shields.io/badge/tsup-FF5D01?style=for-the-badge&logo=esbuild&logoColor=white" alt="tsup" />
</p>

A lightweight, declarative, and extensible TypeScript backend framework built on top of Express. It gives you instant production-ready REST CRUD routes, flexible database drivers (JSON and MongoDB/Mongoose), schema validation via Zod, rich query filtering, and a hybrid dual-authentication engine (JWT + Express Sessions with RBAC).

---

## Features

- **Instant REST APIs**: Define resources declaratively with automatic pagination, sorting, and granular query filtering out of the box.
- **Advanced Query Operators**: Native support for comparison filters (`_gte`, `_lte`, `_gt`, `_lt`, `_ne`), exact matches, and multi-field sorting.
- **Pluggable Database Drivers**: Ships with an atomic file-based `JsonDriver` by default; swap to `MongooseDriver` with zero architectural changes.
- **Hybrid Dual-Auth Architecture**: Stateless `Bearer <JWT>` tokens and stateful Express Session cookies authenticate against the same protected endpoints.
- **Granular RBAC**: Protect routes with unified middleware guards (`authenticate`, `requireRole('admin')`).
- **Dual ESM & CJS**: Fully typed and bundled for modern Node environments with clean subpath exports (`incredible/mongoose`, `incredible/auth`).

---

## Installation

```bash
npm install incredible zod
```

If you plan on using MongoDB:

```bash
npm install mongoose
```

---

## Quick Start

```typescript
import { z } from "zod";
import {
    launchBackend,
    defineResource,
    authenticate,
    requireRole,
} from "incredible";

await launchBackend({
    port: 4000,
    apiPrefix: "/api",
    auth: {
        jwtSecret: process.env.JWT_SECRET || "dev-jwt-secret",
        sessionSecret: process.env.SESSION_SECRET || "dev-session-secret",
    },
    resources: {
        // 1. Unprotected CRUD Resource
        products: defineResource({
            schema: z.object({
                name: z.string().min(2),
                price: z.number().positive(),
                category: z.string(),
                inStock: z.boolean().default(true),
            }),
        }),

        // 2. Protected Resource with RBAC Route Guards
        articles: defineResource({
            schema: z.object({
                title: z.string().min(5),
                body: z.string(),
                status: z.enum(["draft", "published"]).default("draft"),
            }),
            middleware: {
                create: [authenticate],
                update: [authenticate],
                delete: [authenticate, requireRole("admin")],
            },
        }),
    },
});
```

---

## Querying, Filtering & Pagination

Every registered resource automatically supports expressive query string parameters for pagination, sorting, and comparison filtering:

### 1. Pagination

Use `page` and `limit` (or `skip` and `limit`) to get paginated results and metadata:

```http
GET /api/products?page=2&limit=10
```

**Response Format:**

```json
{
  "success": true,
  "pagination": {
    "totalRecords": 45,
    "page": 2,
    "limit": 10,
    "skip": 10,
    "totalPages": 5,
    "hasNextPage": true,
    "hasPrevPage": true
  },
  "data": [ ... ]
}
```

### 2. Multi-Field Sorting

Prefix field names with `-` for descending sort or `+` for ascending sort (comma-separated):

```http
GET /api/products?sort=-price,+createdAt
```

### 3. Comparison & Filter Operators

Filter values are automatically coerced to numbers or booleans where appropriate:

| Query Suffix | Mongo Operator | Example Request                                       | Matches                  |
| ------------ | -------------- | ----------------------------------------------------- | ------------------------ |
| `_gte`       | `$gte`         | `GET /api/products?price_gte=50`                      | `price >= 50`            |
| `_gt`        | `$gt`          | `GET /api/products?price_gt=100`                      | `price > 100`            |
| `_lte`       | `$lte`         | `GET /api/products?price_lte=200`                     | `price <= 200`           |
| `_lt`        | `$lt`          | `GET /api/products?price_lt=20`                       | `price < 20`             |
| `_ne`        | `$ne`          | `GET /api/products?category_ne=clothing`              | `category != 'clothing'` |
| _(exact)_    | exact match    | `GET /api/products?category=electronics&inStock=true` | Exact equality           |

**Combining Filters:**

```http
GET /api/products?category=electronics&price_gte=50&price_lte=500&sort=-price&page=1&limit=5
```

---

## Authentication & Authorization

The framework provides a plug-and-play authentication system built on Passport.js that handles registration, secure password hashing (bcrypt), session cookies, JWT token issuance, and Role-Based Access Control (RBAC).

### Built-in Auth Endpoints

| Method | Endpoint             | Description                                                                                         |
| ------ | -------------------- | --------------------------------------------------------------------------------------------------- |
| `POST` | `/api/auth/register` | Registers a new user, hashes password with bcrypt, and stores in the user adapter                   |
| `POST` | `/api/auth/login`    | Authenticates credentials, returns a signed JWT token in JSON, and sets an HTTP-only session cookie |
| `GET`  | `/api/auth/me`       | Returns the profile payload of the current authenticated user (`req.user`)                          |
| `POST` | `/api/auth/logout`   | Clears active session cookies and logs out the user                                                 |

### Dual Authentication Mechanism

Protected endpoints accept authentication credentials via either:

1. **Stateless Bearer Header**: `Authorization: Bearer <jwt-token>`
2. **Stateful Session Cookie**: `Cookie: connect.sid=...`

Both methods decode the user onto `req.user` identically.

### Route Protection & RBAC Middleware

Import `authenticate` and `requireRole` directly from the package to protect resource lifecycle events or custom routes:

```typescript
import { authenticate, requireRole, defineResource } from "incredible";

const posts = defineResource({
    middleware: {
        // All routes for this resource require an active session or valid JWT
        all: [authenticate],

        // Specific endpoints require explicit roles
        create: [requireRole(["author", "admin"])],
        delete: [requireRole("admin")],
    },
});
```

- **`authenticate`**: Verifies JWT or session cookie. Returns `401 Unauthorized` if invalid or missing.
- **`requireRole(role | role[])`**: Checks `req.user.role`. Returns `403 Forbidden` if role privileges are insufficient.

---

## Database Drivers

### File-Based JSON Driver (`JsonDriver`)

Default zero-setup driver. Stores data in atomic JSON files on disk:

```typescript
import { launchBackend } from "incredible";
import { JsonDriver } from "incredible/database"; // or default

await launchBackend({
    driver: new JsonDriver("./data"),
    // ...
});
```

### MongoDB / Mongoose Driver (`MongooseDriver`)

Production-grade driver utilizing Mongoose models and queries:

```typescript
import { launchBackend } from "incredible";
import { MongooseDriver } from "incredible/mongoose";

const driver = new MongooseDriver(
    process.env.MONGODB_URI || "mongodb://localhost:27017/myapp",
);

await launchBackend({
    driver,
    resources: {
        // Automatically generates a collection model if none is provided
        orders: defineResource(),
    },
});
```

---

## License

MIT License © 2026 Omar Afifi Salama. See [LICENSE](https://www.google.com/search?q=./LICENSE) for details.
