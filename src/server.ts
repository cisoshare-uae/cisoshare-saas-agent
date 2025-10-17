import express from "express";
import cors from "cors";
import { CONFIG } from "./config";
import { health } from "./routes/health";
import { contacts } from "./routes/contacts";
import { employees } from "./routes/employees";
import { agentUsers } from "./routes/agent_users";
import { audit } from "./routes/audit";


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
app.use("/contacts", contacts);
app.use("/employees", employees);
app.use("/agent-users", agentUsers);


// Start
app.listen(CONFIG.PORT, () => {
    console.log(`BYOD Agent listening on http://localhost:${CONFIG.PORT}`);
    console.log(`Schema: ${CONFIG.SCHEMA_VERSION} | Enrollment token: ${CONFIG.ENROLLMENT_TOKEN}`);
});
