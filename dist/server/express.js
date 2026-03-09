import express from "express";
import { errorHandler } from "./middleware/error-handler";
import { requestIdMiddleware } from "./middleware/request-id";
import { responseHeadersMiddleware } from "./middleware/response-headers";
import { router } from "./router";
/**
 * Express app factory — thin HTTP shell
 */
export function createExpressApp() {
    const app = express();
    // Body parsing
    app.use(express.json({ limit: "10mb" }));
    app.use(express.urlencoded({ limit: "10mb", extended: true }));
    // Request middleware
    app.use(requestIdMiddleware);
    app.use(responseHeadersMiddleware);
    // Routes
    app.use("/v1", router);
    // Error handling (must be last)
    app.use(errorHandler);
    return app;
}
//# sourceMappingURL=express.js.map