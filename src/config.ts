// Centralize env + constants (keeps imports clean everywhere)
import * as dotenv from "dotenv";
dotenv.config();

export const CONFIG = {
    PORT: Number(process.env.PORT || 4001),
    DATABASE_URL: process.env.DATABASE_URL || "",
    ENROLLMENT_TOKEN: process.env.ENROLLMENT_TOKEN || "unset",
    OPA_URL: process.env.OPA_URL || "",

    // demo schema/policy versions to render in /health
    SCHEMA_VERSION: "v1-minimal",
    POLICY_VERSION: "live", // OPAL keeps OPA fresh
};
