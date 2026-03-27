import { decryptMessage, encryptMessage } from "@/lib/crypto/nacl";
import type { KeyPairB64 } from "@/lib/crypto/nacl";

export const encryptLiveComment = (
  message: string,
  receiverPublicKeyB64: string,
  senderKeypair: KeyPairB64,
) => encryptMessage(message, receiverPublicKeyB64, senderKeypair.privateKeyB64, senderKeypair.publicKeyB64);

export const decryptLiveComment = (
  payload: { ciphertextB64: string; nonceB64: string; senderPublicKeyB64: string },
  receiverPrivateKeyB64: string,
): string => decryptMessage(payload, receiverPrivateKeyB64);
