import { Router } from "express";
import { healthRouter } from "./health";
/**
 * Route definitions (mount /v1/* paths)
 */
export const router = Router();
// Health checks
router.use("/health", healthRouter);
router.use("/ready", healthRouter);
// Proxy routes
router.post("/chat/completions", (_req, res) => {
    res.status(501).json({ error: "Not implemented" });
});
router.post("/completions", (_req, res) => {
    res.status(501).json({ error: "Not implemented" });
});
router.get("/models", (_req, res) => {
    res.status(501).json({ error: "Not implemented" });
});
//# sourceMappingURL=router.js.map