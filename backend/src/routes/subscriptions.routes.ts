import { Router } from "express";
import { requireWalletSession } from "../middleware/requireWalletSession.js";
import {
  getSubscriptionStatus,
  listMySubscriptions,
  verifySubscriptionByTx,
  verifySubscriptionOrPpvPurchase,
} from "../controllers/subscriptions.controller.js";

const subscriptionsRouter = Router();

subscriptionsRouter.get("/status", getSubscriptionStatus);
subscriptionsRouter.get("/mine", requireWalletSession, listMySubscriptions);
subscriptionsRouter.post("/", requireWalletSession, verifySubscriptionOrPpvPurchase);
subscriptionsRouter.post("/activate", requireWalletSession, verifySubscriptionByTx);
subscriptionsRouter.post("/verify-by-tx", requireWalletSession, verifySubscriptionByTx);
subscriptionsRouter.post("/verify", verifySubscriptionOrPpvPurchase);

export { subscriptionsRouter };
