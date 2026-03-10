import { Router } from "express";
import { getFanProfile, setCreatorFollow, upsertFanProfile } from "../controllers/fans.controller.js";

const fansRouter = Router();

fansRouter.get("/profile/:walletAddress", getFanProfile);
fansRouter.post("/profile", upsertFanProfile);
fansRouter.post("/follow", setCreatorFollow);

export { fansRouter };
