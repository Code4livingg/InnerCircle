const resolveProgramId = (value: string | undefined, fallback: string): string => value?.trim() || fallback;

export const CREATOR_REGISTRY_PROGRAM_ID = "creator_reg_v5_xwnxp.aleo";
export const CREDITS_PROGRAM_ID = "credits.aleo";
export const PAYMENT_PROOF_PROGRAM_ID = resolveProgramId(
  process.env.NEXT_PUBLIC_PAYMENT_PROOF_PROGRAM_ID,
  "sub_invoice_v8_xwnxp.aleo",
);
export const SUBSCRIPTION_PROGRAM_ID = resolveProgramId(
  process.env.NEXT_PUBLIC_SUBSCRIPTION_PROGRAM_ID,
  "sub_pay_v6_xwnxp.aleo",
);
export const TIP_PROGRAM_ID = resolveProgramId(process.env.NEXT_PUBLIC_TIP_PROGRAM_ID, "tip_pay_v5_xwnxp.aleo");
export const USDCX_PROGRAM_ID = resolveProgramId(
  process.env.NEXT_PUBLIC_USDCX_PROGRAM_ID,
  "test_usdcx_stablecoin.aleo",
);

export const uniqueProgramIds = (values: Array<string | undefined>): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
};

export const WALLET_PROGRAM_IDS = uniqueProgramIds([
  CREATOR_REGISTRY_PROGRAM_ID,
  CREDITS_PROGRAM_ID,
  PAYMENT_PROOF_PROGRAM_ID,
  SUBSCRIPTION_PROGRAM_ID,
  TIP_PROGRAM_ID,
  USDCX_PROGRAM_ID,
]);
