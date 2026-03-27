import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { accessRouter } from "./access.routes.js";
import { adminRouter } from "./admin.routes.js";
import { aleoRouter } from "./aleo.routes.js";
import { ageRouter } from "./age.routes.js";
import { contentRouter } from "./content.routes.js";
import { creatorsRouter } from "./creators.routes.js";
import { creatorVerificationsRouter } from "./creatorVerifications.routes.js";
import { discoverRouter } from "./discover.routes.js";
import { fansRouter } from "./fans.routes.js";
import { liveCommentsRouter } from "./liveComments.routes.js";
import { livestreamRouter } from "./livestream.routes.js";
import { mediaRouter } from "./media.routes.js";
import { rolesRouter } from "./roles.routes.js";
import { reportsRouter } from "./reports.routes.js";
import { subscriptionTiersRouter } from "./subscriptionTiers.routes.js";
import { proofsRouter } from "./proofs.routes.js";
import { getCreatorAnalytics } from "../controllers/creators.controller.js";
import { startFingerprintSession } from "../controllers/sessions.controller.js";
import { sessionsRouter } from "./sessions.routes.js";
import { subscriptionsRouter } from "./subscriptions.routes.js";
import { tipsRouter } from "./tips.routes.js";
import { walletRouter } from "./wallet.routes.js";
import { DB_UNAVAILABLE_MESSAGE, isDatabaseUnavailableError } from "../utils/dbErrors.js";

const apiRouter = Router();

apiRouter.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, service: "innercircle-backend", database: "ok" });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      res.status(503).json({
        ok: false,
        service: "innercircle-backend",
        database: "unavailable",
        error: DB_UNAVAILABLE_MESSAGE,
      });
      return;
    }

    res.status(500).json({
      ok: false,
      service: "innercircle-backend",
      database: "error",
      error: (error as Error).message,
    });
  }
});

apiRouter.use("/access", accessRouter);
apiRouter.use("/aleo", aleoRouter);
apiRouter.get("/creator/analytics", getCreatorAnalytics);
apiRouter.use("/creators", creatorsRouter);
apiRouter.use("/content", contentRouter);
apiRouter.use("/discover", discoverRouter);
apiRouter.use("/fans", fansRouter);
apiRouter.use("/livestreams", livestreamRouter);
apiRouter.use("/live-comments", liveCommentsRouter);
apiRouter.use("/media", mediaRouter);
apiRouter.use("/tiers", subscriptionTiersRouter);
apiRouter.use("/tips", tipsRouter);
apiRouter.use("/verifications", creatorVerificationsRouter);
apiRouter.use("/roles", rolesRouter);
apiRouter.use("/reports", reportsRouter);
apiRouter.use("/age", ageRouter);
apiRouter.use("/admin", adminRouter);
apiRouter.use("/subscriptions", subscriptionsRouter);
apiRouter.use("/sessions", sessionsRouter);
apiRouter.use("/proofs", proofsRouter);
apiRouter.post("/start-session", startFingerprintSession);
apiRouter.use("/wallet", walletRouter);

export { apiRouter };
