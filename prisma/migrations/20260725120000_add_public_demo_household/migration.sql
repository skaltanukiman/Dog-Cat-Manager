ALTER TABLE "households"
ADD COLUMN "is_demo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "demo_slug" TEXT;

CREATE UNIQUE INDEX "households_demo_slug_key" ON "households"("demo_slug");
