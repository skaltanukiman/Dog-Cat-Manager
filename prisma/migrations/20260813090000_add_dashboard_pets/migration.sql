CREATE TABLE "dashboard_pets" (
    "id" TEXT NOT NULL,
    "settingId" TEXT NOT NULL,
    "petId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_pets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dashboard_pets_settingId_petId_key" ON "dashboard_pets"("settingId", "petId");
CREATE INDEX "dashboard_pets_petId_idx" ON "dashboard_pets"("petId");

ALTER TABLE "dashboard_pets"
ADD CONSTRAINT "dashboard_pets_settingId_fkey"
FOREIGN KEY ("settingId") REFERENCES "app_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dashboard_pets"
ADD CONSTRAINT "dashboard_pets_petId_fkey"
FOREIGN KEY ("petId") REFERENCES "pets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
