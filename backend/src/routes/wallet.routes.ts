import { Router } from "express";
import { createWalletSession, verifyWalletSignature } from "../controllers/wallet.controller.js";

const walletRouter = Router();

walletRouter.post("/session", createWalletSession);
walletRouter.post("/verify-signature", verifyWalletSignature);

export { walletRouter };
