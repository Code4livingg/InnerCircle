import { Router } from "express";
import {
  createTip,
  createAnonymousTip,
  getCreatorTipHistory,
  getTipHistoryForFan,
  getTipLeaderboard,
} from "../controllers/tips.controller.js";
import { requireWalletSession } from "../middleware/requireWalletSession.js";

const tipsRouter = Router();

tipsRouter.get("/leaderboard/:handle", getTipLeaderboard);
tipsRouter.post("/anonymous", createAnonymousTip);
tipsRouter.post("/", createTip);
tipsRouter.use(requireWalletSession);
tipsRouter.get("/creator/:handle", getCreatorTipHistory);
tipsRouter.get("/history", getTipHistoryForFan);

export { tipsRouter };
