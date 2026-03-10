import { Router } from "express";
import {
  getStreamManifest,
  streamChunk,
  unlockContent,
  unlockSubscription,
} from "../controllers/access.controller.js";
import { requireSession } from "../middleware/requireSession.js";

const accessRouter = Router();

accessRouter.post("/unlock/subscription", unlockSubscription);
accessRouter.post("/unlock/content", unlockContent);
accessRouter.get("/stream/:contentId/manifest", requireSession, getStreamManifest);
accessRouter.get("/stream/:contentId/chunk", requireSession, streamChunk);

export { accessRouter };