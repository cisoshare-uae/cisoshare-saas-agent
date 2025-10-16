// OPA/OPAL policy check helper. Your code remains the PEP; OPA is the PDP.
import fetch from "node-fetch";
import { CONFIG } from "./config";

/**
 * checkPolicy(input) -> boolean
 * - input example:
 *   { action: "delete", resource: "contacts", user: { role: "admin" } }
 */
export async function checkPolicy(input: unknown): Promise<boolean> {
    // For the PoC, if OPA is not configured, allow to avoid blocking.
    if (!CONFIG.OPA_URL) return true;

    try {
        const r = await fetch(CONFIG.OPA_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ input }),
        });
        const json: any = await r.json();
        return Boolean(json?.result);
    } catch {
        // In production: fail-closed (deny). Here we allow to reduce friction.
        return false;
    }
}
