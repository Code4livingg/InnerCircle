import { Router } from "express";
import { attestKyc, attestZk, status } from "../controllers/age.controller.js";

const ageRouter = Router();

ageRouter.get("/status", status);
ageRouter.post("/attest/kyc", attestKyc);
ageRouter.post("/attest/zk", attestZk);

export { ageRouter };

