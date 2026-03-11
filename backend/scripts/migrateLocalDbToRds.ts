import { PrismaClient } from "@prisma/client";

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main() {
  const localDatabaseUrl = getRequiredEnv("LOCAL_DATABASE_URL");
  const remoteDatabaseUrl = getRequiredEnv("REMOTE_DATABASE_URL");

  const source = new PrismaClient({
    datasources: {
      db: {
        url: localDatabaseUrl,
      },
    },
  });

  const target = new PrismaClient({
    datasources: {
      db: {
        url: remoteDatabaseUrl,
      },
    },
  });

  try {
    const [
      creators,
      fanProfiles,
      walletRoles,
      creatorFollows,
      contents,
      contentChunks,
      streamEvents,
      subscriptionPurchases,
      ppvPurchases,
    ] = await Promise.all([
      source.creator.findMany(),
      source.fanProfile.findMany(),
      source.walletRole.findMany(),
      source.creatorFollow.findMany(),
      source.content.findMany(),
      source.contentChunk.findMany(),
      source.streamEvent.findMany(),
      source.subscriptionPurchase.findMany(),
      source.ppvPurchase.findMany(),
    ]);

    await target.streamEvent.deleteMany();
    await target.ppvPurchase.deleteMany();
    await target.subscriptionPurchase.deleteMany();
    await target.contentChunk.deleteMany();
    await target.creatorFollow.deleteMany();
    await target.content.deleteMany();
    await target.fanProfile.deleteMany();
    await target.walletRole.deleteMany();
    await target.creator.deleteMany();

    if (creators.length > 0) {
      await target.creator.createMany({ data: creators });
    }
    if (fanProfiles.length > 0) {
      await target.fanProfile.createMany({ data: fanProfiles });
    }
    if (walletRoles.length > 0) {
      await target.walletRole.createMany({ data: walletRoles });
    }
    if (creatorFollows.length > 0) {
      await target.creatorFollow.createMany({ data: creatorFollows });
    }
    if (contents.length > 0) {
      await target.content.createMany({ data: contents });
    }
    if (contentChunks.length > 0) {
      await target.contentChunk.createMany({ data: contentChunks });
    }
    if (subscriptionPurchases.length > 0) {
      await target.subscriptionPurchase.createMany({ data: subscriptionPurchases });
    }
    if (ppvPurchases.length > 0) {
      await target.ppvPurchase.createMany({ data: ppvPurchases });
    }
    if (streamEvents.length > 0) {
      await target.streamEvent.createMany({ data: streamEvents });
    }

    console.log(
      JSON.stringify({
        migrated: {
          creators: creators.length,
          fanProfiles: fanProfiles.length,
          walletRoles: walletRoles.length,
          creatorFollows: creatorFollows.length,
          contents: contents.length,
          contentChunks: contentChunks.length,
          subscriptionPurchases: subscriptionPurchases.length,
          ppvPurchases: ppvPurchases.length,
          streamEvents: streamEvents.length,
        },
      }),
    );
  } finally {
    await Promise.all([source.$disconnect(), target.$disconnect()]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
