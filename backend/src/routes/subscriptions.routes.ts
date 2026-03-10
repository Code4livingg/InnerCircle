import { Router } from "express";
import {
  getSubscriptionStatus,
  verifySubscriptionOrPpvPurchase,
} from "../controllers/subscriptions.controller.js";

const subscriptionsRouter = Router();

subscriptionsRouter.get("/status", getSubscriptionStatus);
subscriptionsRouter.post("/verify", verifySubscriptionOrPpvPurchase);

export { subscriptionsRouter };
