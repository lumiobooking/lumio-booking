# Changelog — Lumio Booking plugin

## 1.7.3 (2026-07-23)
- SECURITY: conversion bridge now VALIDATES every message — origin must be the
  configured Lumio origin, schema_version must be 1, salon_slug must match this
  site's configured slug, transaction_id must be non-empty, and the sender must
  be an iframe this document owns pointing at the Lumio origin. Unverified
  messages are dropped silently. Idempotent per transaction_id.
- NEW: "Conversion delivery" setting (gtm | ga4 | none | auto). gtm always
  pushes booking_completed to the dataLayer (queued even before GTM loads);
  ga4 calls gtag purchase; auto keeps the legacy heuristic for old sites.
- NEW: first-party attribution store — first-touch + last-touch (utm_*, gclid,
  gbraid, wbraid, landing URL, referrer, captured_at) kept 30 days in
  localStorage, forwarded into the booking form so multi-page journeys keep
  their source; saved with the booking server-side.
- NEW: every Lumio iframe gets po= (this site's origin) so the form posts the
  conversion to a verified origin — postMessage("*") is gone.

## 1.7.2 (2026-07-23)
- Instant updates: Plugins screen re-checks the manifest on open; hourly cron
  self-installs new builds.

## 1.7.1 (2026-07-23)
- Forward embedded-form booking conversions into the site's GTM/GA4.
