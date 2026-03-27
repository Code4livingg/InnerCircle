import { Router } from "express";
import {
  getCreatorAnalyticsByWalletAddress,
  getCreatorAnalytics,
  getCreatorByHandle,
  getCreatorByWalletAddress,
  listCreators,
  registerCreator,
  setCreatorPaymentPreferences,
  setCreatorPricing,
} from "../controllers/creators.controller.js";

const creatorsRouter = Router();

creatorsRouter.post("/register", registerCreator);
creatorsRouter.get("/", listCreators);
creatorsRouter.get("/analytics", getCreatorAnalytics);
creatorsRouter.get("/analytics/:walletAddress", getCreatorAnalyticsByWalletAddress);
creatorsRouter.get("/by-wallet/:walletAddress", getCreatorByWalletAddress);
creatorsRouter.get("/:handle", getCreatorByHandle);
creatorsRouter.post("/pricing", setCreatorPricing);
creatorsRouter.post("/payment-preferences", setCreatorPaymentPreferences);

export { creatorsRouter };
