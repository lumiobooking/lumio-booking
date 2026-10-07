-- Sales bot: who names a price. 'sales' = a person quotes (the bot never states one); 'facts' = the bot may quote from its facts.
ALTER TABLE "messenger_connections" ADD COLUMN IF NOT EXISTS "quotePolicy" TEXT NOT NULL DEFAULT 'sales';
