import { Router } from "express";
import { reviewCreatorVerification } from "../controllers/creatorVerifications.controller.js";
import { listReports } from "../controllers/reports.controller.js";
import { requireAdmin } from "../middleware/requireAdmin.js";

const adminRouter = Router();

adminRouter.get("/reports", requireAdmin, listReports);
adminRouter.post("/creator-verifications/:handle/review", requireAdmin, reviewCreatorVerification);

export { adminRouter };
