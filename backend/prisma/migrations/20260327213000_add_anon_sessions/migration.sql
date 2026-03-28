-- CreateTable
CREATE TABLE "anon_sessions" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "circleId" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "expiresAtBlock" INTEGER NOT NULL,
    "nullifierHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anon_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "anon_sessions_sessionId_key" ON "anon_sessions"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "anon_sessions_nullifierHash_key" ON "anon_sessions"("nullifierHash");
