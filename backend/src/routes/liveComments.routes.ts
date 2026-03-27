import { Router } from "express";
import { requireWalletSession } from "../middleware/requireWalletSession.js";
import {
  getCreatorKey,
  listPrivateComments,
  postPrivateComment,
  registerCreatorKey,
} from "../controllers/liveComments.controller.js";

const liveCommentsRouter = Router();

liveCommentsRouter.post("/creator-key", requireWalletSession, registerCreatorKey);
liveCommentsRouter.get("/creator-key/:creatorId", getCreatorKey);
liveCommentsRouter.post("/:liveStreamId", postPrivateComment);
liveCommentsRouter.get("/:liveStreamId", requireWalletSession, listPrivateComments);

export { liveCommentsRouter };
