import { Request, Response } from "express";
import { z } from "zod";
import { ExplorerRequestError, fetchCreditsPublicBalance } from "../services/aleoExplorerService.js";

const MICRO_PER_ALEO = 1_000_000n;

const paramsSchema = z.object({
  walletAddress: z.string().regex(/^aleo1[0-9a-z]{20,}$/i),
});

const microToAleo = (micro: bigint): string => {
  const whole = micro / MICRO_PER_ALEO;
  const fraction = (micro % MICRO_PER_ALEO).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction.length > 0 ? `${whole.toString()}.${fraction}` : whole.toString();
};

export const getPublicBalance = async (req: Request, res: Response): Promise<void> => {
  const parsed = paramsSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid wallet address", code: "BAD_WALLET_ADDRESS" });
    return;
  }

  try {
    const microcredits = await fetchCreditsPublicBalance(parsed.data.walletAddress);
    res.json({
      walletAddress: parsed.data.walletAddress,
      publicBalanceMicrocredits: microcredits.toString(),
      publicBalanceAleo: microToAleo(microcredits),
    });
  } catch (error) {
    if (error instanceof ExplorerRequestError) {
      res.status(502).json({
        error: error.message,
        code: "EXPLORER_BALANCE_LOOKUP_FAILED",
      });
      return;
    }

    res.status(500).json({
      error: (error as Error).message,
      code: "UNKNOWN_BALANCE_LOOKUP_ERROR",
    });
  }
};

