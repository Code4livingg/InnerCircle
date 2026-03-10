import { Router } from "express";
import { listReports } from "../controllers/reports.controller.js";
import { requireAdmin } from "../middleware/requireAdmin.js";

const adminRouter = Router();

adminRouter.get("/reports", requireAdmin, listReports);

export { adminRouter };

