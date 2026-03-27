import nacl from "tweetnacl";
import { base64ToBytes, bytesToBase64, bytesToUtf8, utf8ToBytes } from "./encoding";

export interface KeyPairB64 {
  publicKeyB64: string;
  privateKeyB64: string;
}

export interface EncryptedPayloadB64 {
  ciphertextB64: string;
  nonceB64: string;
  senderPublicKeyB64: string;
}

export const generateKeypair = (): KeyPairB64 => {
  const kp = nacl.box.keyPair();
  return {
    publicKeyB64: bytesToBase64(kp.publicKey),
    privateKeyB64: bytesToBase64(kp.secretKey),
  };
};

export const encryptMessage = (
  message: string,
  receiverPublicKeyB64: string,
  senderPrivateKeyB64: string,
  senderPublicKeyB64: string,
): EncryptedPayloadB64 => {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const ciphertext = nacl.box(
    utf8ToBytes(message),
    nonce,
    base64ToBytes(receiverPublicKeyB64),
    base64ToBytes(senderPrivateKeyB64),
  );

  if (!ciphertext) {
    throw new Error("Failed to encrypt message.");
  }

  return {
    ciphertextB64: bytesToBase64(ciphertext),
    nonceB64: bytesToBase64(nonce),
    senderPublicKeyB64,
  };
};

export const decryptMessage = (
  payload: { ciphertextB64: string; nonceB64: string; senderPublicKeyB64: string },
  receiverPrivateKeyB64: string,
): string => {
  const plaintext = nacl.box.open(
    base64ToBytes(payload.ciphertextB64),
    base64ToBytes(payload.nonceB64),
    base64ToBytes(payload.senderPublicKeyB64),
    base64ToBytes(receiverPrivateKeyB64),
  );

  if (!plaintext) {
    throw new Error("Failed to decrypt message.");
  }

  return bytesToUtf8(plaintext);
};
