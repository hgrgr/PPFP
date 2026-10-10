-- CreateEnum
CREATE TYPE "RepaymentMethod" AS ENUM ('AMORTIZING', 'EQUAL_PRINCIPAL', 'BULLET', 'REVOLVING', 'CUSTOM');

-- CreateEnum
CREATE TYPE "DelegationLevel" AS ENUM ('SUGGEST', 'APPROVE', 'AUTO');

-- CreateEnum
CREATE TYPE "TradeMode" AS ENUM ('PAPER', 'LIVE');

-- CreateEnum
CREATE TYPE "OrderSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_APPROVAL', 'BLOCKED', 'DISMISSED', 'EXPIRED', 'SUBMITTING', 'SUBMITTED', 'PARTIAL', 'FILLED', 'CANCELLED', 'REJECTED', 'UNKNOWN');

-- AlterEnum
ALTER TYPE "TxnType" ADD VALUE 'REPAY';

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "stepUpUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "BrokerConnection" ADD COLUMN     "tradeEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tradeEnabledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Portfolio" ADD COLUMN     "strategyVersionId" TEXT;

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "kind" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "loanPaymentId" TEXT;

-- AlterTable
ALTER TABLE "AiSettings" ADD COLUMN     "tradingHaltReason" TEXT,
ADD COLUMN     "tradingHaltedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Loan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "lent" BOOLEAN NOT NULL DEFAULT false,
    "lender" TEXT,
    "counterparty" TEXT,
    "principal" DECIMAL(24,6) NOT NULL,
    "creditLimit" DECIMAL(24,6),
    "startDate" DATE NOT NULL,
    "maturityDate" DATE,
    "method" "RepaymentMethod" NOT NULL,
    "graceMonths" INTEGER NOT NULL DEFAULT 0,
    "paymentDay" INTEGER NOT NULL DEFAULT 1,
    "rateType" TEXT NOT NULL DEFAULT 'FIXED',
    "nextResetAt" DATE,
    "prepayFeeRate" DECIMAL(20,10) NOT NULL DEFAULT 0,
    "prepayFeeMonths" INTEGER NOT NULL DEFAULT 0,
    "collateralId" TEXT,
    "payFromId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanRate" (
    "loanId" TEXT NOT NULL,
    "from" DATE NOT NULL,
    "rate" DECIMAL(20,10) NOT NULL,

    CONSTRAINT "LoanRate_pkey" PRIMARY KEY ("loanId","from")
);

-- CreateTable
CREATE TABLE "LoanPayment" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "dueDate" DATE,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "principal" DECIMAL(24,6) NOT NULL,
    "interest" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "fee" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "balanceAfter" DECIMAL(24,6) NOT NULL,
    "prepayment" BOOLEAN NOT NULL DEFAULT false,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialProfile" (
    "userId" TEXT NOT NULL,
    "annualIncome" DECIMAL(24,6),
    "birthYear" INTEGER,
    "retireAge" INTEGER,
    "region" TEXT,
    "emergencyMonths" INTEGER NOT NULL DEFAULT 6,
    "shareWithAi" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "AutopilotPolicy" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "connectionId" TEXT,
    "portfolioId" TEXT NOT NULL,
    "level" "DelegationLevel" NOT NULL DEFAULT 'SUGGEST',
    "mode" "TradeMode" NOT NULL DEFAULT 'PAPER',
    "objective" TEXT NOT NULL DEFAULT '',
    "allowedTypes" "AssetType"[] DEFAULT ARRAY['KR_STOCK']::"AssetType"[],
    "allowSymbols" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "denySymbols" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxOrder" DECIMAL(24,6) NOT NULL,
    "maxDaily" DECIMAL(24,6) NOT NULL,
    "maxDailyOrders" INTEGER NOT NULL DEFAULT 5,
    "dailyLossStop" DECIMAL(20,10) NOT NULL DEFAULT 0.02,
    "maxPriceGap" DECIMAL(20,10) NOT NULL DEFAULT 0.03,
    "paperCash" DECIMAL(24,6) NOT NULL DEFAULT 10000000,
    "slippageBp" INTEGER NOT NULL DEFAULT 10,
    "version" INTEGER NOT NULL DEFAULT 1,
    "haltedAt" TIMESTAMP(3),
    "haltReason" TEXT,
    "cycleClaimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopilotPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentDecision" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "trigger" TEXT NOT NULL,
    "conversationId" TEXT,
    "outcome" TEXT NOT NULL,
    "rationale" TEXT NOT NULL DEFAULT '',
    "counterpoints" TEXT NOT NULL DEFAULT '',
    "tainted" BOOLEAN NOT NULL DEFAULT false,
    "taintSources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "model" TEXT,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "decisionId" TEXT,
    "aiActionId" TEXT,
    "connectionId" TEXT,
    "mode" "TradeMode" NOT NULL,
    "assetId" TEXT,
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL DEFAULT 'KRX',
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "side" "OrderSide" NOT NULL,
    "orderType" TEXT NOT NULL DEFAULT 'LIMIT',
    "qty" DECIMAL(28,8) NOT NULL,
    "limitPrice" DECIMAL(24,6),
    "reserved" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "clientOrderId" TEXT NOT NULL,
    "brokerOrderId" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "checks" JSONB NOT NULL DEFAULT '[]',
    "filledQty" DECIMAL(28,8) NOT NULL DEFAULT 0,
    "avgFillPrice" DECIMAL(24,6),
    "error" TEXT,
    "expiresAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderFill" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "brokerFillId" TEXT,
    "qty" DECIMAL(28,8) NOT NULL,
    "price" DECIMAL(24,6) NOT NULL,
    "fee" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "tax" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "estimated" BOOLEAN NOT NULL DEFAULT false,
    "filledAt" TIMESTAMP(3) NOT NULL,
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderFill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Strategy" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "oneLine" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'custom',
    "skillId" TEXT,
    "sageId" TEXT,
    "activeVersion" INTEGER,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Strategy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyVersion" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "principles" TEXT NOT NULL DEFAULT '',
    "rules" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "lint" JSONB NOT NULL DEFAULT '[]',
    "author" TEXT NOT NULL DEFAULT 'user',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "benchmark" TEXT NOT NULL DEFAULT '069500',
    "feeBps" DECIMAL(8,2) NOT NULL DEFAULT 15,
    "taxBps" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "computedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Loan_assetId_key" ON "Loan"("assetId");

-- CreateIndex
CREATE INDEX "Loan_userId_idx" ON "Loan"("userId");

-- CreateIndex
CREATE INDEX "Loan_collateralId_idx" ON "Loan"("collateralId");

-- CreateIndex
CREATE INDEX "LoanPayment_loanId_paidAt_idx" ON "LoanPayment"("loanId", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "LoanPayment_loanId_dueDate_key" ON "LoanPayment"("loanId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "AutopilotPolicy_connectionId_key" ON "AutopilotPolicy"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "AutopilotPolicy_portfolioId_key" ON "AutopilotPolicy"("portfolioId");

-- CreateIndex
CREATE INDEX "AutopilotPolicy_userId_idx" ON "AutopilotPolicy"("userId");

-- CreateIndex
CREATE INDEX "AgentDecision_policyId_createdAt_idx" ON "AgentDecision"("policyId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentDecision_userId_createdAt_idx" ON "AgentDecision"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TradeOrder_aiActionId_key" ON "TradeOrder"("aiActionId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeOrder_clientOrderId_key" ON "TradeOrder"("clientOrderId");

-- CreateIndex
CREATE INDEX "TradeOrder_status_updatedAt_idx" ON "TradeOrder"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "TradeOrder_policyId_createdAt_idx" ON "TradeOrder"("policyId", "createdAt");

-- CreateIndex
CREATE INDEX "TradeOrder_userId_createdAt_idx" ON "TradeOrder"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TradeOrder_connectionId_brokerOrderId_key" ON "TradeOrder"("connectionId", "brokerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderFill_transactionId_key" ON "OrderFill"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderFill_orderId_seq_key" ON "OrderFill"("orderId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "Strategy_userId_name_key" ON "Strategy"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "StrategyVersion_strategyId_version_key" ON "StrategyVersion"("strategyId", "version");

-- CreateIndex
CREATE INDEX "StrategyRun_userId_active_idx" ON "StrategyRun"("userId", "active");

-- CreateIndex
CREATE INDEX "StrategyRun_versionId_idx" ON "StrategyRun"("versionId");

-- CreateIndex
CREATE INDEX "Portfolio_strategyVersionId_idx" ON "Portfolio"("strategyVersionId");

-- CreateIndex
CREATE INDEX "Transaction_loanPaymentId_idx" ON "Transaction"("loanPaymentId");

-- AddForeignKey
ALTER TABLE "Portfolio" ADD CONSTRAINT "Portfolio_strategyVersionId_fkey" FOREIGN KEY ("strategyVersionId") REFERENCES "StrategyVersion"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_loanPaymentId_fkey" FOREIGN KEY ("loanPaymentId") REFERENCES "LoanPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_collateralId_fkey" FOREIGN KEY ("collateralId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_payFromId_fkey" FOREIGN KEY ("payFromId") REFERENCES "Portfolio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanRate" ADD CONSTRAINT "LoanRate_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanPayment" ADD CONSTRAINT "LoanPayment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialProfile" ADD CONSTRAINT "FinancialProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopilotPolicy" ADD CONSTRAINT "AutopilotPolicy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopilotPolicy" ADD CONSTRAINT "AutopilotPolicy_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopilotPolicy" ADD CONSTRAINT "AutopilotPolicy_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "BrokerConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDecision" ADD CONSTRAINT "AgentDecision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDecision" ADD CONSTRAINT "AgentDecision_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "AutopilotPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDecision" ADD CONSTRAINT "AgentDecision_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeOrder" ADD CONSTRAINT "TradeOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeOrder" ADD CONSTRAINT "TradeOrder_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "AutopilotPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeOrder" ADD CONSTRAINT "TradeOrder_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "AgentDecision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeOrder" ADD CONSTRAINT "TradeOrder_aiActionId_fkey" FOREIGN KEY ("aiActionId") REFERENCES "AiAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeOrder" ADD CONSTRAINT "TradeOrder_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "BrokerConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeOrder" ADD CONSTRAINT "TradeOrder_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderFill" ADD CONSTRAINT "OrderFill_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "TradeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderFill" ADD CONSTRAINT "OrderFill_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Strategy" ADD CONSTRAINT "Strategy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyVersion" ADD CONSTRAINT "StrategyVersion_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyRun" ADD CONSTRAINT "StrategyRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyRun" ADD CONSTRAINT "StrategyRun_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "StrategyVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

