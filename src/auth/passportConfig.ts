import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as JwtStrategy, ExtractJwt } from "passport-jwt";
import bcrypt from "bcryptjs";
import type { DatabaseAdapter } from "../database/types.js";
import type { BaseUserRecord } from "./types.js";

export interface ConfigurePassportOptions {
    userAdapter: DatabaseAdapter<BaseUserRecord>;
    jwtSecret: string;
}

export function configurePassport({
    userAdapter,
    jwtSecret,
}: ConfigurePassportOptions): typeof passport {
    // 1. Local Strategy (Username & Password verification)
    passport.use(
        new LocalStrategy(
            { usernameField: "username", passwordField: "password" },
            async (username, password, done) => {
                try {
                    const users = await userAdapter.find({
                        filter: { username },
                    });
                    const user = users[0];

                    if (!user || !user.password) {
                        return done(null, false, {
                            message: "Invalid username or password.",
                        });
                    }

                    const isMatch = await bcrypt.compare(
                        password,
                        user.password,
                    );
                    if (!isMatch) {
                        return done(null, false, {
                            message: "Invalid username or password.",
                        });
                    }

                    return done(null, user);
                } catch (err) {
                    return done(err);
                }
            },
        ),
    );

    // 2. JWT Strategy (Header: Authorization: Bearer <token>)
    passport.use(
        new JwtStrategy(
            {
                jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
                secretOrKey: jwtSecret,
            },
            async (jwtPayload, done) => {
                try {
                    const user = await userAdapter.findById(jwtPayload.id);
                    if (!user) {
                        return done(null, false);
                    }
                    return done(null, user);
                } catch (err) {
                    return done(err, false);
                }
            },
        ),
    );

    // 3. Session Serialization (Store ID in cookie session)
    passport.serializeUser((user: any, done) => {
        done(null, user.id);
    });

    // 4. Session Deserialization (Rehydrate user on subsequent requests)
    passport.deserializeUser(async (id: string, done) => {
        try {
            const user = await userAdapter.findById(id);
            done(null, user || null);
        } catch (err) {
            done(err, null);
        }
    });

    return passport;
}
