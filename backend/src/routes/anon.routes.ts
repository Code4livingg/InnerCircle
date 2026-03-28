import { Router } from "express";
import { registerAnonSession } from "../controllers/anon.controller.js";

const anonRouter = Router();

anonRouter.post("/register", registerAnonSession);

export { anonRouter };
