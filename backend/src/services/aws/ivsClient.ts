import { IvsClient } from "@aws-sdk/client-ivs";
import { env } from "../../config/env.js";

// Always pin IVS to the approved region. Use env override but fallback to ap-southeast-2.
const region = env.ivsRegion || "ap-southeast-2";

export const ivsClient = new IvsClient({
  region,
  credentials: {
    accessKeyId: env.awsAccessKeyId,
    secretAccessKey: env.awsSecretAccessKey,
  },
});

