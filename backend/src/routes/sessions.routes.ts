import { Router } from "express";
import { createAccessSession } from "../controllers/sessions.controller.js";

const sessionsRouter = Router();

sessionsRouter.post("/create", createAccessSession);

export { sessionsRouter };
