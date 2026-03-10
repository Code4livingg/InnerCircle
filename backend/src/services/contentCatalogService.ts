import type { StoredEncryptedContent } from "./streamingService.js";

// In production this should be a database-backed repository.
const encryptedCatalog = new Map<string, StoredEncryptedContent>();

export const upsertEncryptedContent = (entry: StoredEncryptedContent): void => {
  encryptedCatalog.set(entry.contentId, entry);
};

export const getEncryptedContent = (contentId: string): StoredEncryptedContent | undefined => {
  return encryptedCatalog.get(contentId);
};