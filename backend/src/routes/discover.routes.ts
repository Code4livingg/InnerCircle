import { Router } from "express";
import { getFeed, search } from "../controllers/discover.controller.js";

const discoverRouter = Router();

discoverRouter.get("/feed", getFeed);
discoverRouter.get("/search", search);

export { discoverRouter };

