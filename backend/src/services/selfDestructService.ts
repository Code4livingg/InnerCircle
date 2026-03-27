import { prisma } from "../db/prisma.js";
import { deleteEncryptedContent } from "./contentCatalogService.js";

export interface SelfDestructState {
  expiresAt: Date | null;
  viewLimit: number | null;
  views: number;
}

export const isExpired = (expiresAt: Date | null): boolean =>
  Boolean(expiresAt && expiresAt.getTime() <= Date.now());

export const hasReachedViewLimit = (views: number, viewLimit: number | null): boolean =>
  Boolean(viewLimit && viewLimit > 0 && views >= viewLimit);

export const deleteContentRecord = async (contentId: string): Promise<void> => {
  await prisma.content.delete({ where: { id: contentId } }).catch(() => undefined);
  deleteEncryptedContent(contentId);
};

export const ensureNotSelfDestructed = async (contentId: string, state: SelfDestructState): Promise<void> => {
  if (isExpired(state.expiresAt) || hasReachedViewLimit(state.views, state.viewLimit)) {
    await deleteContentRecord(contentId);
    throw new Error("Content has expired or reached its view limit.");
  }
};

export const incrementViewsAndMaybeDelete = async (
  contentId: string,
): Promise<{ views: number; viewLimit: number | null } | null> => {
  const updated = await prisma.content.update({
    where: { id: contentId },
    data: { views: { increment: 1 } },
    select: { views: true, viewLimit: true },
  }).catch(() => null);

  if (!updated) return null;

  if (hasReachedViewLimit(updated.views, updated.viewLimit)) {
    await deleteContentRecord(contentId);
  }

  return updated;
};
