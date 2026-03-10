import { Router } from "express";
import { claimWalletRole, getWalletRole } from "../controllers/roles.controller.js";

const rolesRouter = Router();

rolesRouter.get("/:walletAddress", getWalletRole);
rolesRouter.post("/claim", claimWalletRole);

export { rolesRouter };
