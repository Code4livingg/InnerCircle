import dotenv from 'dotenv';
dotenv.config({ path: './.env' });
import { IvsClient, ListChannelsCommand } from '@aws-sdk/client-ivs';

const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, IVS_REGION } = process.env;
console.log('Loaded env', { IVS_REGION, accessKeyIdPresent: !!AWS_ACCESS_KEY_ID, secretPresent: !!AWS_SECRET_ACCESS_KEY, secretLength: AWS_SECRET_ACCESS_KEY?.length });

const client = new IvsClient({
  region: IVS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
});

try {
  const res = await client.send(new ListChannelsCommand({ maxResults: 1 }));
  console.log(JSON.stringify(res, null, 2));
} catch (err) {
  console.error('IVS list-channels failed:', err);
  process.exit(1);
}
