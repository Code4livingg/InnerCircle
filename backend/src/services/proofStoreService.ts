import { prisma } from "../db/prisma.js";

export interface PaymentProofStatus {
  valid: boolean;
  createdAt: Date | null;
  txHash: string | null;
}

export interface MembershipProofStatus {
  valid: boolean;
  createdAt: Date | null;
}

export interface SubscriptionNullifierStatus {
  exists: boolean;
  usable: boolean;
  circleId: string | null;
  expiresAt: Date | null;
  usedAt: Date | null;
}

export const storePaymentProof = async (input: { contentId: string; proof: string; txHash?: string | null }): Promise<void> => {
  await prisma.paymentProof.upsert({
    where: {
      contentId_proof: {
        contentId: input.contentId,
        proof: input.proof,
      },
    },
    update: {
      txHash: input.txHash ?? undefined,
    },
    create: {
      contentId: input.contentId,
      proof: input.proof,
      txHash: input.txHash ?? null,
    },
  });
};

export const getPaymentProofStatus = async (proof: string, contentId: string): Promise<PaymentProofStatus> => {
  const record = await prisma.paymentProof.findFirst({
    where: {
      contentId,
      proof,
    },
    select: { createdAt: true, txHash: true },
  });

  return {
    valid: Boolean(record),
    createdAt: record?.createdAt ?? null,
    txHash: record?.txHash ?? null,
  };
};

export const storeMembershipProof = async (input: { circleId: string; proof: string }): Promise<void> => {
  await prisma.membershipProof.upsert({
    where: {
      circleId_proof: {
        circleId: input.circleId,
        proof: input.proof,
      },
    },
    update: {},
    create: {
      circleId: input.circleId,
      proof: input.proof,
    },
  });
};

export const getMembershipProofStatus = async (proof: string, circleId: string): Promise<MembershipProofStatus> => {
  const record = await prisma.membershipProof.findFirst({
    where: {
      circleId,
      proof,
    },
    select: { createdAt: true },
  });

  return {
    valid: Boolean(record),
    createdAt: record?.createdAt ?? null,
  };
};

export const verifyProof = async (proof: string, contentId: string): Promise<boolean> => {
  const status = await getPaymentProofStatus(proof, contentId);
  return status.valid;
};

export const verifyPaymentProof = verifyProof;

export const verifyMembership = async (proof: string, circleId: string): Promise<boolean> => {
  const status = await getMembershipProofStatus(proof, circleId);
  return status.valid;
};

export const verifyMembershipProof = verifyMembership;

/**
 * Stores a subscription invoice nullifier for renewal/replay tracking.
 */
export const storeNullifier = async (
  nullifier: string,
  circleId: string,
  expiresAt: number,
): Promise<void> => {
  const expiresAtDate = new Date(expiresAt);

  await prisma.subscriptionNullifier.upsert({
    where: { nullifier },
    update: {
      circleId,
      expiresAt: expiresAtDate,
    },
    create: {
      nullifier,
      circleId,
      expiresAt: expiresAtDate,
    },
  });
};

/**
 * Returns whether a subscription nullifier exists and is not expired.
 */
export const checkNullifier = async (nullifier: string): Promise<boolean> => {
  const record = await prisma.subscriptionNullifier.findUnique({
    where: { nullifier },
    select: {
      expiresAt: true,
    },
  });

  if (!record) {
    return false;
  }

  return record.expiresAt.getTime() > Date.now();
};

/**
 * Reads the full stored status for a subscription nullifier.
 */
export const getNullifierStatus = async (nullifier: string): Promise<SubscriptionNullifierStatus> => {
  const record = await prisma.subscriptionNullifier.findUnique({
    where: { nullifier },
    select: {
      circleId: true,
      expiresAt: true,
      usedAt: true,
    },
  });

  if (!record) {
    return {
      exists: false,
      usable: false,
      circleId: null,
      expiresAt: null,
      usedAt: null,
    };
  }

  const usable = record.expiresAt.getTime() > Date.now();
  return {
    exists: true,
    usable,
    circleId: record.circleId,
    expiresAt: record.expiresAt,
    usedAt: record.usedAt,
  };
};

/**
 * Legacy helper retained for backwards compatibility with older flows.
 */
export const markNullifierUsed = async (nullifier: string): Promise<void> => {
  await prisma.subscriptionNullifier.update({
    where: { nullifier },
    data: {
      usedAt: new Date(),
    },
  });
};
