import { Router } from "express";
import multer from "multer";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { getContent, streamContent, streamPublicContent, uploadContent } from "../controllers/content.controller.js";
import { requireSession } from "../middleware/requireSession.js";
import { env } from "../config/env.js";

const tmpDir = resolve(env.storageLocalDir, "tmp");
mkdirSync(tmpDir, { recursive: true });

const upload = multer({
  dest: tmpDir,
  limits: {
    fileSize: 1024 * 1024 * 1024, // 1GB
  },
});

const uploadContentWithFiles = (req: Parameters<typeof uploadContent>[0], res: Parameters<typeof uploadContent>[1], next: (err?: unknown) => void): void => {
  upload.fields([
    { name: "file", maxCount: 1 },
    { name: "thumbnail", maxCount: 1 },
  ])(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError) {
      const isSizeError = error.code === "LIMIT_FILE_SIZE";
      res.status(isSizeError ? 413 : 400).json({
        error: isSizeError
          ? "Uploaded file exceeds the 1GB size limit."
          : error.code === "LIMIT_UNEXPECTED_FILE"
            ? "Invalid file field in upload payload."
            : error.message,
      });
      return;
    }

    res.status(400).json({ error: (error as Error).message || "Invalid upload payload." });
  });
};

const contentRouter = Router();

contentRouter.post("/upload", uploadContentWithFiles, uploadContent);
contentRouter.get("/:contentId", getContent);
contentRouter.get("/:contentId/public-stream", streamPublicContent);
contentRouter.get("/:contentId/stream", requireSession, streamContent);

export { contentRouter };
