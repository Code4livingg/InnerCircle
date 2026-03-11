import { Router } from "express";
import { getMediaAccessUrl } from "../controllers/media.controller.js";
import { requireSession } from "../middleware/requireSession.js";

const mediaRouter = Router();

mediaRouter.get("/:id", requireSession, getMediaAccessUrl);

export { mediaRouter };
