import express from "express";
import cors from "cors";
import { CONFIG } from "./config";
import { health } from "./routes/health";
import { agentUsers } from "./routes/agent_users";
import { audit } from "./routes/audit";
import { internalEmployeesRouter } from "./routes/internal/hr/employees";
import { internalDocumentsRouter } from "./routes/internal/documents";
import { internalTemplatesRouter } from "./routes/internal/templates";


// Add near the top (after imports) to generate simple correlation ids
const newReqId = () => `req_${Math.random().toString(36).slice(2, 10)}`;
const app = express();
app.use(cors());
app.use(express.json());
app.use((req, _res, next) => {
    (req as any).reqId = newReqId();
    next();
});

// Mount routes
app.use(health);
app.use(audit);
// OLD route - deprecated in favor of /agent/internal/employees
// app.use("/employees", employees);
app.use("/agent-users", agentUsers);

// Internal API routes (standardized Agent API contract)
app.use("/agent/internal/employees", internalEmployeesRouter);
app.use("/agent/internal/documents", internalDocumentsRouter);
app.use("/agent/internal/templates", internalTemplatesRouter);


// Start
app.listen(CONFIG.PORT, () => {
    console.log(`BYOD Agent listening on http://localhost:${CONFIG.PORT}`);
    console.log(`Schema: ${CONFIG.SCHEMA_VERSION} | Enrollment token: ${CONFIG.ENROLLMENT_TOKEN}`);
});
