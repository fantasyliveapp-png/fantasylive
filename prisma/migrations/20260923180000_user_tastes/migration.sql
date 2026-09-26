-- AlterTable
ALTER TABLE "users" ADD COLUMN     "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "lookingFor" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "onboardedAt" TIMESTAMP(3),
ADD COLUMN     "preferredGenders" "Gender"[] DEFAULT ARRAY[]::"Gender"[];

