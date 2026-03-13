import { Router } from "express";
import {
  createTip,
  getCreatorTipHistory,
  getTipHistoryForFan,
  getTipLeaderboard,
} from "../controllers/tips.controller.js";
import { requireWalletSession } from "../middleware/requireWalletSession.js";

const tipsRouter = Router();

tipsRouter.get("/leaderboard/:handle", getTipLeaderboard);
tipsRouter.use(requireWalletSession);
tipsRouter.post("/", createTip);
tipsRouter.get("/creator/:handle", getCreatorTipHistory);
tipsRouter.get("/history", getTipHistoryForFan);

export { tipsRouter };
