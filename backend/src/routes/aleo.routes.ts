import { Router } from "express";
import { getPublicBalance } from "../controllers/aleo.controller.js";

const aleoRouter = Router();

aleoRouter.get("/public-balance/:walletAddress", getPublicBalance);

export { aleoRouter };

