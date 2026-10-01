-- CreateEnum
CREATE TYPE "WithdrawalReservationStatus" AS ENUM ('reserved', 'settled', 'released');

-- CreateTable
CREATE TABLE "talent_withdrawal_reservations" (
    "id" TEXT NOT NULL,
    "paymentInstructionId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "status" "WithdrawalReservationStatus" NOT NULL DEFAULT 'reserved',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "talent_withdrawal_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "talent_withdrawal_reservations_lotId_status_idx" ON "talent_withdrawal_reservations"("lotId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "talent_withdrawal_reservations_paymentInstructionId_lotId_key" ON "talent_withdrawal_reservations"("paymentInstructionId", "lotId");

-- AddForeignKey
ALTER TABLE "talent_withdrawal_reservations" ADD CONSTRAINT "talent_withdrawal_reservations_paymentInstructionId_fkey" FOREIGN KEY ("paymentInstructionId") REFERENCES "payment_instructions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "talent_withdrawal_reservations" ADD CONSTRAINT "talent_withdrawal_reservations_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "talent_balance_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "talent_withdrawal_reservations"
  ADD CONSTRAINT "talent_withdrawal_reservations_positive_amount_check" CHECK ("amount" > 0);

