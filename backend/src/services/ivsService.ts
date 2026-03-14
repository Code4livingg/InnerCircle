import {
  CreateChannelCommand,
  CreateStreamKeyCommand,
  DeleteChannelCommand,
  DeletePlaybackKeyPairCommand,
  DeleteStreamKeyCommand,
  GetStreamKeyCommand,
  ImportPlaybackKeyPairCommand,
  ListChannelsCommand,
  ListStreamKeysCommand,
  StopStreamCommand,
} from "@aws-sdk/client-ivs";
import { createCipheriv, createDecipheriv, generateKeyPairSync, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import { b64ToBuffer, bufferToB64 } from "../utils/crypto.js";
import { randomFieldLiteral } from "../utils/aleo.js";
import { ivsClient } from "./aws/ivsClient.js";

const STATUS_LIVE = "live";
const STATUS_OFFLINE = "offline";
const STREAM_KEY_QUOTA_PATTERN = /stream-key quota exceeded/i;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const masterKey = (): Buffer => {
  const key = b64ToBuffer(env.masterKeyBase64);
  if (key.length !== 32) {
    throw new Error("MASTER_KEY_BASE64 must decode to 32 bytes for IVS key encryption.");
  }
  return key;
};

const encryptSecret = (value: string): { ciphertextB64: string; ivB64: string; authTagB64: string } => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertextB64: bufferToB64(ciphertext),
    ivB64: bufferToB64(iv),
    authTagB64: bufferToB64(authTag),
  };
};

const decryptSecret = (ciphertextB64?: string | null, ivB64?: string | null, authTagB64?: string | null): string => {
  if (!ciphertextB64 || !ivB64 || !authTagB64) {
    throw new Error("Live stream playback private key is unavailable.");
  }

  const decipher = createDecipheriv("aes-256-gcm", masterKey(), b64ToBuffer(ivB64));
  decipher.setAuthTag(b64ToBuffer(authTagB64));
  const plaintext = Buffer.concat([
    decipher.update(b64ToBuffer(ciphertextB64)),
    decipher.final(),
  ]);

  return plaintext.toString("utf8");
};

const sanitizeName = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "innercircle-live";

const buildAllowedOriginsClaim = (): Record<string, string | boolean> => {
  if (env.corsOrigins.length === 0) {
    return {};
  }

  return {
    "aws:access-control-allow-origin": env.corsOrigins.join(","),
    "aws:strict-origin-enforcement": true,
  };
};

const cleanupAwsResources = async ({
  playbackKeyPairArn,
  streamKeyArn,
  channelArn,
}: {
  playbackKeyPairArn?: string;
  streamKeyArn?: string;
  channelArn?: string;
}): Promise<void> => {
  await Promise.allSettled([
    playbackKeyPairArn
      ? ivsClient.send(new DeletePlaybackKeyPairCommand({ arn: playbackKeyPairArn }))
      : Promise.resolve(),
    streamKeyArn ? ivsClient.send(new DeleteStreamKeyCommand({ arn: streamKeyArn })) : Promise.resolve(),
    channelArn ? ivsClient.send(new DeleteChannelCommand({ arn: channelArn })) : Promise.resolve(),
  ]);
};

const deleteStreamKeysForChannel = async (channelArn: string): Promise<void> => {
  let streamKeyToken: string | undefined;
  do {
    const keysResponse = await ivsClient.send(
      new ListStreamKeysCommand({ channelArn, maxResults: 50, nextToken: streamKeyToken }),
    );
    streamKeyToken = keysResponse.nextToken;

    for (const streamKey of keysResponse.streamKeys ?? []) {
      if (!streamKey.arn) {
        continue;
      }
      try {
        await ivsClient.send(new DeleteStreamKeyCommand({ arn: streamKey.arn }));
      } catch (error) {
        console.warn("IVS: failed to delete stream key", {
          streamKeyArn: streamKey.arn,
          error: (error as Error).message,
        });
      }
    }
  } while (streamKeyToken);
};

const fetchExistingStreamKey = async (
  channelArn: string,
): Promise<{ streamKeyArn: string; streamKeyValue: string } | null> => {
  let streamKeyToken: string | undefined;
  do {
    const keysResponse = await ivsClient.send(
      new ListStreamKeysCommand({ channelArn, maxResults: 50, nextToken: streamKeyToken }),
    );
    streamKeyToken = keysResponse.nextToken;

    for (const streamKey of keysResponse.streamKeys ?? []) {
      if (!streamKey.arn) {
        continue;
      }
      const detail = await ivsClient.send(new GetStreamKeyCommand({ arn: streamKey.arn }));
      const value = detail.streamKey?.value;
      if (!value) {
        continue;
      }
      return { streamKeyArn: streamKey.arn, streamKeyValue: value };
    }
  } while (streamKeyToken);

  return null;
};

const ensureStreamKeyForChannel = async (
  channelArn: string,
): Promise<{ streamKeyArn: string; streamKeyValue: string }> => {
  await deleteStreamKeysForChannel(channelArn);

  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const streamKeyResponse = await ivsClient.send(new CreateStreamKeyCommand({ channelArn }));
      const streamKeyArn = streamKeyResponse.streamKey?.arn;
      const streamKeyValue = streamKeyResponse.streamKey?.value;
      if (!streamKeyArn || !streamKeyValue) {
        throw new Error("IVS did not return a stream key.");
      }
      return { streamKeyArn, streamKeyValue };
    } catch (error) {
      lastError = error;
      const message = (error as Error).message ?? "";
      if (STREAM_KEY_QUOTA_PATTERN.test(message)) {
        console.warn("IVS: stream key quota exceeded after delete; retrying", { attempt, message });
        await sleep(400 * attempt);
        continue;
      }
      break;
    }
  }

  const existing = await fetchExistingStreamKey(channelArn);
  if (existing) {
    return existing;
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to create IVS stream key.");
};

const cleanupStaleStreamKeys = async (): Promise<void> => {
  const activeChannels = await prisma.liveStream.findMany({
    where: { status: STATUS_LIVE },
    select: { ivsChannelArn: true },
  });
  const activeChannelArns = new Set(activeChannels.map((stream) => stream.ivsChannelArn));
  if (env.ivsChannelArn) {
    activeChannelArns.add(env.ivsChannelArn);
  }

  let nextToken: string | undefined;
  do {
    const channelsResponse = await ivsClient.send(new ListChannelsCommand({ maxResults: 50, nextToken }));
    nextToken = channelsResponse.nextToken;

    for (const channel of channelsResponse.channels ?? []) {
      const channelArn = channel.arn;
      if (!channelArn || activeChannelArns.has(channelArn)) {
        continue;
      }

      await deleteStreamKeysForChannel(channelArn);
    }
  } while (nextToken);
};

export interface CreateIvsChannelInput {
  creatorId: string;
  title: string;
  accessType: "SUBSCRIPTION" | "PPV";
  ppvPriceMicrocredits?: bigint | null;
}

export interface CreateIvsChannelResult {
  liveStreamId: string;
  ingestEndpoint: string;
  streamKeyValue: string;
  playbackUrl: string;
}

export const createIvsChannel = async ({
  creatorId,
  title,
  accessType,
  ppvPriceMicrocredits,
}: CreateIvsChannelInput): Promise<CreateIvsChannelResult> => {
  console.log("IVS: creating channel", { accessType, region: env.ivsRegion });

  const creator = await prisma.creator.findUnique({
    where: { id: creatorId },
    select: { id: true, handle: true },
  });

  if (!creator) {
    throw new Error("Creator not found.");
  }

  const activeLiveStream = await prisma.liveStream.findFirst({
    where: {
      creatorId,
      status: STATUS_LIVE,
    },
    select: { id: true },
  });

  if (activeLiveStream) {
    throw new Error("This creator already has an active live stream.");
  }

  await cleanupStaleStreamKeys();

  const previousLiveStream = await prisma.liveStream.findFirst({
    where: { creatorId },
    orderBy: { createdAt: "desc" },
    select: {
      status: true,
      ivsChannelArn: true,
      streamKeyArn: true,
      playbackKeyPairArn: true,
    },
  });

  if (previousLiveStream && previousLiveStream.status !== STATUS_LIVE) {
    console.log("IVS: cleaning up previous stream key before creating a new one", {
      streamKeyArn: previousLiveStream.streamKeyArn,
    });
    const shouldDeletePreviousChannel =
      !!previousLiveStream.ivsChannelArn && previousLiveStream.ivsChannelArn !== env.ivsChannelArn;
    await cleanupAwsResources({
      playbackKeyPairArn: previousLiveStream.playbackKeyPairArn ?? undefined,
      streamKeyArn: previousLiveStream.streamKeyArn ?? undefined,
      channelArn: shouldDeletePreviousChannel ? previousLiveStream.ivsChannelArn ?? undefined : undefined,
    });
  }

  const staticChannel =
    env.ivsChannelArn && env.ivsIngestEndpoint && env.ivsPlaybackUrl
      ? {
        channelArn: env.ivsChannelArn,
        ingestEndpoint: env.ivsIngestEndpoint,
        playbackUrl: env.ivsPlaybackUrl,
      }
      : null;

  const channelName = sanitizeName(`${creator.handle}-${title}-${Date.now()}`);
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "secp384r1",
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });

  let channelArn: string | undefined;
  let streamKeyArn: string | undefined;
  let playbackKeyPairArn: string | undefined;
  let ingestEndpoint: string | undefined;
  let playbackUrl: string | undefined;
  let streamKeyValue: string | undefined;
  const shouldDeleteChannelOnError = !staticChannel;

  try {
    if (staticChannel) {
      channelArn = staticChannel.channelArn;
      ingestEndpoint = staticChannel.ingestEndpoint;
      playbackUrl = staticChannel.playbackUrl;
      console.log("IVS: using existing channel", { channelArn, ingestEndpoint, playbackUrl });
    } else {
      const createChannelResponse = await ivsClient.send(
        new CreateChannelCommand({
          authorized: true,
          latencyMode: "LOW",
          name: channelName,
          type: "STANDARD",
        }),
      );

      channelArn = createChannelResponse.channel?.arn;
      ingestEndpoint = createChannelResponse.channel?.ingestEndpoint;
      playbackUrl = createChannelResponse.channel?.playbackUrl;
      console.log("IVS: channel created", { channelArn, ingestEndpoint, playbackUrl });
    }

    if (!channelArn || !ingestEndpoint || !playbackUrl) {
      throw new Error("IVS channel creation returned incomplete channel details.");
    }

    const streamKey = await ensureStreamKeyForChannel(channelArn);
    streamKeyArn = streamKey.streamKeyArn;
    streamKeyValue = streamKey.streamKeyValue;
    console.log("IVS: stream key ready", { streamKeyArn });

    const playbackKeyResponse = await ivsClient.send(
      new ImportPlaybackKeyPairCommand({
        name: sanitizeName(`${channelName}-playback-key`),
        publicKeyMaterial: publicKey,
      }),
    );

    playbackKeyPairArn = playbackKeyResponse.keyPair?.arn;
    console.log("IVS: playback key pair imported", { playbackKeyPairArn });
    if (!playbackKeyPairArn) {
      throw new Error("IVS did not return a playback key pair ARN.");
    }

    const encryptedPrivateKey = encryptSecret(privateKey);

    const liveStream = await prisma.liveStream.create({
      data: {
        creatorId,
        ivsChannelArn: channelArn,
        ivsChannelName: staticChannel ? channelName : channelName,
        streamKeyArn,
        streamKeyValue,
        ingestEndpoint,
        playbackUrl,
        playbackKeyPairArn,
        playbackPublicKey: publicKey,
        playbackPrivateKeyCiphertextB64: encryptedPrivateKey.ciphertextB64,
        playbackPrivateKeyIvB64: encryptedPrivateKey.ivB64,
        playbackPrivateKeyAuthTagB64: encryptedPrivateKey.authTagB64,
        purchaseFieldId: randomFieldLiteral(),
        title,
        accessType,
        ppvPriceMicrocredits: accessType === "PPV" ? ppvPriceMicrocredits ?? 0n : null,
        status: STATUS_LIVE,
        startedAt: new Date(),
      },
      select: {
        id: true,
        ingestEndpoint: true,
        streamKeyValue: true,
        playbackUrl: true,
      },
    });

    return {
      liveStreamId: liveStream.id,
      ingestEndpoint: liveStream.ingestEndpoint,
      streamKeyValue: liveStream.streamKeyValue,
      playbackUrl: liveStream.playbackUrl,
    };
  } catch (error) {
    console.error("IVS CreateChannel error", error);
    await cleanupAwsResources({
      playbackKeyPairArn,
      streamKeyArn,
      channelArn: shouldDeleteChannelOnError ? channelArn : undefined,
    });
    throw new Error((error as Error).message || "Failed to create IVS channel");
  }
};

export const issuePlaybackToken = async (
  liveStreamId: string,
  walletHash: string,
  durationSeconds = env.ivsTokenTtlSeconds,
): Promise<{ token: string; expiresAt: number; playbackUrl: string }> => {
  const liveStream = await prisma.liveStream.findUnique({
    where: { id: liveStreamId },
    select: {
      playbackUrl: true,
      ivsChannelArn: true,
      playbackPrivateKeyCiphertextB64: true,
      playbackPrivateKeyIvB64: true,
      playbackPrivateKeyAuthTagB64: true,
    },
  });

  if (!liveStream) {
    throw new Error("Live stream not found.");
  }

  const expiresAt = Math.floor(Date.now() / 1000) + durationSeconds;
  const privateKey = decryptSecret(
    liveStream.playbackPrivateKeyCiphertextB64,
    liveStream.playbackPrivateKeyIvB64,
    liveStream.playbackPrivateKeyAuthTagB64,
  );

  const token = jwt.sign(
    {
      "aws:channel-arn": liveStream.ivsChannelArn,
      ...buildAllowedOriginsClaim(),
      walletHash,
      exp: expiresAt,
    },
    privateKey,
    { algorithm: "ES384" },
  );

  return {
    token,
    expiresAt,
    playbackUrl: liveStream.playbackUrl,
  };
};

export const endIvsChannel = async (liveStreamId: string): Promise<void> => {
  const liveStream = await prisma.liveStream.findUnique({
    where: { id: liveStreamId },
    select: {
      ivsChannelArn: true,
      streamKeyArn: true,
      playbackKeyPairArn: true,
    },
  });

  if (!liveStream) {
    throw new Error("Live stream not found.");
  }

  await Promise.allSettled([
    ivsClient.send(new StopStreamCommand({ channelArn: liveStream.ivsChannelArn })),
    liveStream.streamKeyArn
      ? ivsClient.send(new DeleteStreamKeyCommand({ arn: liveStream.streamKeyArn }))
      : Promise.resolve(),
    liveStream.playbackKeyPairArn
      ? ivsClient.send(new DeletePlaybackKeyPairCommand({ arn: liveStream.playbackKeyPairArn }))
      : Promise.resolve(),
  ]);

  await prisma.liveStream.update({
    where: { id: liveStreamId },
    data: {
      status: STATUS_OFFLINE,
      endedAt: new Date(),
      streamKeyValue: "",
      playbackKeyPairArn: null,
      playbackPrivateKeyCiphertextB64: null,
      playbackPrivateKeyIvB64: null,
      playbackPrivateKeyAuthTagB64: null,
    },
  });
};

export const listLiveStreams = async () => {
  return prisma.liveStream.findMany({
    where: { status: STATUS_LIVE },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      title: true,
      accessType: true,
      ppvPriceMicrocredits: true,
      status: true,
      startedAt: true,
      endedAt: true,
      createdAt: true,
      playbackUrl: true,
      creatorId: true,
      creator: {
        select: {
          handle: true,
          displayName: true,
          isVerified: true,
          walletAddress: true,
          subscriptionPriceMicrocredits: true,
        },
      },
    },
  });
};

export const getLiveStreamById = async (liveStreamId: string) => {
  return prisma.liveStream.findUnique({
    where: { id: liveStreamId },
    select: {
      id: true,
      title: true,
      accessType: true,
      ppvPriceMicrocredits: true,
      status: true,
      startedAt: true,
      endedAt: true,
      createdAt: true,
      playbackUrl: true,
      creatorId: true,
      creator: {
        select: {
          handle: true,
          displayName: true,
          isVerified: true,
          walletAddress: true,
          creatorFieldId: true,
          subscriptionPriceMicrocredits: true,
          walletHash: true,
        },
      },
      purchaseFieldId: true,
    },
  });
};
