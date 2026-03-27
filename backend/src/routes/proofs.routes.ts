import { Router } from "express";
import { requireWalletSession } from "../middleware/requireWalletSession.js";
import {
  submitMembershipProof,
  submitPaymentProof,
  verifyMembershipProofStatus,
  verifyPaymentProofStatus,
} from "../controllers/proofs.controller.js";

const proofsRouter = Router();

proofsRouter.post("/payment", requireWalletSession, submitPaymentProof);
proofsRouter.post("/payment/verify", verifyPaymentProofStatus);
proofsRouter.post("/membership", requireWalletSession, submitMembershipProof);
proofsRouter.post("/membership/verify", verifyMembershipProofStatus);

export { proofsRouter };
