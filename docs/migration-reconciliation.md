# Migration history review

The production database includes manually applied finance, cash-closing, commission rules and commission 2C schema changes. Four local migration versions are not recorded in the remote Supabase migration history. Two later local migration filenames were aligned to their recorded remote versions.

Do not run `supabase db push` until the four earlier SQL scripts have been checked against the live schema and their history reconciled with the official CLI migration repair process. Confirm schema constraints, policies, triggers, functions and grants, including the stricter 2C snapshot constraint and trigger guard.

The history repair operation is not a schema update. Take and restore-test a recent backup before any history repair.

Official guide: https://supabase.com/docs/guides/deployment/database-migrations
