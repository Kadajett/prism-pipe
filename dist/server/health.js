import { Router } from "express";
/**
 * GET /health, GET /ready
 */
export const healthRouter = Router();
healthRouter.get("/", (_req, res) => {
    res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
    });
});
//# sourceMappingURL=health.js.map