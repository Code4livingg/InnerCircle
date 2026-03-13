import { Router } from "express";
import {
  createSubscriptionTier,
  deleteSubscriptionTier,
  listMySubscriptionTiers,
  listSubscriptionTiersByCreator,
  updateSubscriptionTier,
} from "../controllers/subscriptionTiers.controller.js";
import { requireWalletSession } from "../middleware/requireWalletSession.js";

const subscriptionTiersRouter = Router();

subscriptionTiersRouter.get("/creator/:handle", listSubscriptionTiersByCreator);
subscriptionTiersRouter.use(requireWalletSession);
subscriptionTiersRouter.get("/mine", listMySubscriptionTiers);
subscriptionTiersRouter.post("/", createSubscriptionTier);
subscriptionTiersRouter.put("/:id", updateSubscriptionTier);
subscriptionTiersRouter.delete("/:id", deleteSubscriptionTier);

export { subscriptionTiersRouter };
