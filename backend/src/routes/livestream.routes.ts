import { Router } from "express";
import {
  createLiveStream,
  endLiveStream,
  getActiveLiveStream,
  getLiveStreamPlaybackToken,
  listActiveLiveStreams,
  verifyLiveStreamPpvPurchase,
} from "../controllers/livestreams.controller.js";
import { requireWalletSession } from "../middleware/requireWalletSession.js";

const livestreamRouter = Router();

livestreamRouter.use(requireWalletSession);
livestreamRouter.post("/", createLiveStream);
livestreamRouter.get("/", listActiveLiveStreams);
livestreamRouter.get("/:id", getActiveLiveStream);
livestreamRouter.get("/:id/token", getLiveStreamPlaybackToken);
livestreamRouter.post("/:id/purchase/verify", verifyLiveStreamPpvPurchase);
livestreamRouter.post("/:id/end", endLiveStream);

export { livestreamRouter };
