-- AlterTable
ALTER TABLE "users" ADD COLUMN "telegramId" TEXT;
ALTER TABLE "users" ADD COLUMN "telegramLinkCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_telegramId_key" ON "users"("telegramId");
