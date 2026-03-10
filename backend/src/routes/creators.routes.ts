import { Router } from "express";
import {
  getCreatorAnalyticsByWalletAddress,
  getCreatorByHandle,
  getCreatorByWalletAddress,
  listCreators,
  registerCreator,
  setCreatorPricing,
} from "../controllers/creators.controller.js";

const creatorsRouter = Router();

creatorsRouter.post("/register", registerCreator);
creatorsRouter.get("/", listCreators);
creatorsRouter.get("/analytics/:walletAddress", getCreatorAnalyticsByWalletAddress);
creatorsRouter.get("/by-wallet/:walletAddress", getCreatorByWalletAddress);
creatorsRouter.get("/:handle", getCreatorByHandle);
creatorsRouter.post("/pricing", setCreatorPricing);

export { creatorsRouter };
