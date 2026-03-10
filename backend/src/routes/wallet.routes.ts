import { Router } from "express";
import { verifyWalletSignature } from "../controllers/wallet.controller.js";

const walletRouter = Router();

walletRouter.post("/verify-signature", verifyWalletSignature);

export { walletRouter };
