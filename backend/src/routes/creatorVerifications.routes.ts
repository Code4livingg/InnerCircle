import { Router } from "express";
import {
  getCreatorVerificationStatus,
  submitCreatorVerification,
} from "../controllers/creatorVerifications.controller.js";
import { requireWalletSession } from "../middleware/requireWalletSession.js";

const creatorVerificationsRouter = Router();

creatorVerificationsRouter.get("/:handle", getCreatorVerificationStatus);
creatorVerificationsRouter.use(requireWalletSession);
creatorVerificationsRouter.post("/submit", submitCreatorVerification);

export { creatorVerificationsRouter };
