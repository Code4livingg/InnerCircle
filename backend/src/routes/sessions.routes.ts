import { Router } from "express";
import { createAccessSession } from "../controllers/sessions.controller.js";
import { requireAnonOrWallet } from "../middleware/requireAnonOrWallet.js";

const sessionsRouter = Router();

sessionsRouter.post("/unlock", requireAnonOrWallet, createAccessSession);
sessionsRouter.post("/create", requireAnonOrWallet, createAccessSession);

export { sessionsRouter };
