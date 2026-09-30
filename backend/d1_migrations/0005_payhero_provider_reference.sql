-- PayHero's /transaction-status endpoint requires the "reference" value THEY
-- generate and return in the initiate-payment response (a separate field from
-- both our external_reference and their CheckoutRequestID) - discovered via a live
-- test call, which returned 404 until this was captured and used.
ALTER TABLE payhero_deposits ADD COLUMN provider_reference TEXT;
