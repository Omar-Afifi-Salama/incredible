// tsup.config.ts
import { defineConfig } from "tsup";

export default defineConfig({
    entry: [
        "src/index.ts",
        "src/database/MongooseDriver.ts",
        "src/auth/index.ts",
    ],
    format: ["esm", "cjs"],
    dts: false,
    clean: true,
    sourcemap: true,
    target: "node18",
    external: [
        "express",
        "mongoose",
        "passport",
        "passport-local",
        "passport-jwt",
        "jsonwebtoken",
        "bcryptjs",
        "express-session",
        "cors",
        "zod",
    ],
});
