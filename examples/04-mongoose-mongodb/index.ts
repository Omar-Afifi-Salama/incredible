import mongoose from "mongoose";
import { z } from "zod";
import { launchBackend, defineResource } from "incrediblejs";
import { MongooseDriver, MongooseDbAdapter } from "incrediblejs/mongoose";

// 1. Define Mongoose Model
const ProductModel = mongoose.model(
    "Product",
    new mongoose.Schema(
        {
            sku: { type: String, required: true, unique: true },
            title: { type: String, required: true },
            price: { type: Number, required: true },
            stock: { type: Number, default: 0 },
        },
        { timestamps: true },
    ),
);

// 2. Launch Backend with MongooseDriver
await launchBackend({
    port: 4003,
    apiPrefix: "/api",
    driver: new MongooseDriver(
        process.env.MONGO_URI || "mongodb://localhost:27017/store_demo",
    ),
    resources: {
        products: defineResource({
            adapter: new MongooseDbAdapter(ProductModel),
            schema: z.object({
                sku: z.string().min(3),
                title: z.string().min(2),
                price: z.number().positive(),
                stock: z.number().int().nonnegative().default(0),
            }),
        }),
    },
});

console.log(
    "🍃 MongoDB/Mongoose server running on http://localhost:4003/api/products",
);
