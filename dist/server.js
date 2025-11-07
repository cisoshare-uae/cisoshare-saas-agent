"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const config_1 = require("./config");
const health_1 = require("./routes/health");
const contacts_1 = require("./routes/contacts");
const agent_users_1 = require("./routes/agent_users");
const audit_1 = require("./routes/audit");
const employees_1 = require("./routes/internal/hr/employees");
const documents_1 = require("./routes/internal/documents");
// Add near the top (after imports) to generate simple correlation ids
const newReqId = () => `req_${Math.random().toString(36).slice(2, 10)}`;
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use((req, _res, next) => {
    req.reqId = newReqId();
    next();
});
// Mount routes
app.use(health_1.health);
app.use(audit_1.audit);
app.use("/contacts", contacts_1.contacts);
// OLD route - deprecated in favor of /agent/internal/employees
// app.use("/employees", employees);
app.use("/agent-users", agent_users_1.agentUsers);
// Internal API routes (standardized Agent API contract)
app.use("/agent/internal/employees", employees_1.internalEmployeesRouter);
app.use("/agent/internal/documents", documents_1.internalDocumentsRouter);
// Start
app.listen(config_1.CONFIG.PORT, () => {
    console.log(`BYOD Agent listening on http://localhost:${config_1.CONFIG.PORT}`);
    console.log(`Schema: ${config_1.CONFIG.SCHEMA_VERSION} | Enrollment token: ${config_1.CONFIG.ENROLLMENT_TOKEN}`);
});
