-- M-Pesa phone number collected at signup so users don't retype it at deposit time.
ALTER TABLE users ADD COLUMN phone_number TEXT;
