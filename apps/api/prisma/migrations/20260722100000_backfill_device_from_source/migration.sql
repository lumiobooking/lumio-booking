-- Recover the device for bookings made before device had its own column.
-- Back then a bug wrote the device string ('web'/'mobile') into `source`,
-- which erased the real channel. We can at least recover the device, and set
-- those rows' channel to the generic 'online' (plugin vs hosted is unrecoverable
-- for historical rows).
UPDATE "appointments"
   SET "device" = "source"
 WHERE "device" IS NULL
   AND "source" IN ('web', 'mobile');

UPDATE "appointments"
   SET "source" = 'online'
 WHERE "source" IN ('web', 'mobile');
