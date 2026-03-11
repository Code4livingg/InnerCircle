import { Router } from "express";
import multer from "multer";
import { getContent, uploadContent } from "../controllers/content.controller.js";

const upload = multer({
  storage: multer.memoryStorage(),
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

export { contentRouter };
