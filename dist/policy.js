"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkPolicy = checkPolicy;
// OPA/OPAL policy check helper. Your code remains the PEP; OPA is the PDP.
const node_fetch_1 = __importDefault(require("node-fetch"));
const config_1 = require("./config");
/**
 * checkPolicy(input) -> boolean
 * - input example:
 *   { action: "delete", resource: "contacts", user: { role: "admin" } }
 */
async function checkPolicy(input) {
    // For the PoC, if OPA is not configured, allow to avoid blocking.
    if (!config_1.CONFIG.OPA_URL)
        return true;
    try {
        const r = await (0, node_fetch_1.default)(config_1.CONFIG.OPA_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ input }),
        });
        const json = await r.json();
        return Boolean(json?.result);
    }
    catch {
        // In production: fail-closed (deny). Here we allow to reduce friction.
        return false;
    }
}
