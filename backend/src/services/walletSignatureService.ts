import { TextEncoder } from "node:util";
import { env } from "../config/env.js";

type AleoSdkModule = {
  Address: {
    from_string: (value: string) => {
      verify: (message: Uint8Array, signature: unknown) => boolean;
    };
  };
  Signature: {
    from_string: (value: string) => unknown;
  };
};

const loadAleoSdk = async (): Promise<AleoSdkModule> => {
  const modulePath =
    env.aleoNetwork === "mainnet"
      ? "@provablehq/sdk/mainnet.js"
      : "@provablehq/sdk/testnet.js";

  return (await import(modulePath)) as AleoSdkModule;
};

export const verifyAleoWalletSignature = async (
  walletAddress: string,
  message: string,
  rawSignature: string,
): Promise<boolean> => {
  const { Address, Signature } = await loadAleoSdk();

  const address = Address.from_string(walletAddress);
  const signature = Signature.from_string(rawSignature.trim());
  const messageBytes = new TextEncoder().encode(message);

  return address.verify(messageBytes, signature);
};
