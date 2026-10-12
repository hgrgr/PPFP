-- AlterTable
ALTER TABLE "User" ADD COLUMN     "benchmarks" TEXT[] DEFAULT ARRAY[]::TEXT[];

