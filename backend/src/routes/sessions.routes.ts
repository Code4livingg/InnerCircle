import { Router } from "express";
import { requireWalletSession } from "../middleware/requireWalletSession.js";
import { createAccessSession } from "../controllers/sessions.controller.js";

const sessionsRouter = Router();

sessionsRouter.post("/unlock", requireWalletSession, createAccessSession);
sessionsRouter.post("/create", createAccessSession);

export { sessionsRouter };
