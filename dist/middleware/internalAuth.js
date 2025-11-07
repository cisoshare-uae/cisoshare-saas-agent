"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireInternalAuth = requireInternalAuth;
const config_1 = require("../config");
/**
 * Middleware to protect internal endpoints.
 * Expects X-Agent-Secret header to match AGENT_API_SECRET.
 */
function requireInternalAuth(req, res, next) {
    const providedSecret = req.header("X-Agent-Secret");
    if (!providedSecret) {
        return res.status(401).json({
            ok: false,
            error: "unauthorized",
            message: "X-Agent-Secret header required"
        });
    }
    if (providedSecret !== config_1.CONFIG.AGENT_API_SECRET) {
        return res.status(403).json({
            ok: false,
            error: "forbidden",
            message: "Invalid secret"
        });
    }
    next();
}
