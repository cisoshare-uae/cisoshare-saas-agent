import { Request, Response, NextFunction } from "express";
import { CONFIG } from "../config";

/**
 * Middleware to protect internal endpoints.
 * Expects X-Agent-Secret header to match AGENT_API_SECRET.
 */
export function requireInternalAuth(req: Request, res: Response, next: NextFunction) {
    const providedSecret = req.header("X-Agent-Secret");

    if (!providedSecret) {
        return res.status(401).json({
            ok: false,
            error: "unauthorized",
            message: "X-Agent-Secret header required"
        });
    }

    if (providedSecret !== CONFIG.AGENT_API_SECRET) {
        return res.status(403).json({
            ok: false,
            error: "forbidden",
            message: "Invalid secret"
        });
    }

    next();
}
