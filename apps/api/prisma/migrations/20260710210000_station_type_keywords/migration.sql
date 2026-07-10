-- Editable keywords that auto-route a service to a chair type (automation + control).
ALTER TABLE "station_types" ADD COLUMN "keywords" TEXT;

-- Seed sensible defaults for the common types so it works out of the box.
UPDATE "station_types" SET "keywords" = CASE lower("name")
  WHEN 'pedi' THEN 'pedi,pedicure,chân,chan,foot,spa'
  WHEN 'mani' THEN 'mani,manicure,tay,hand'
  WHEN 'nail' THEN 'nail,gel,dip,acrylic,bột,bot,fill,tip,shellac,powder,full set'
  ELSE "keywords" END;
