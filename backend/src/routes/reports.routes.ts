import { Router } from "express";
import { createReport } from "../controllers/reports.controller.js";

const reportsRouter = Router();

reportsRouter.post("/", createReport);

export { reportsRouter };

