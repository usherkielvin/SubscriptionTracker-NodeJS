import pg from 'pg';

import { DATABASE_URL, NODE_ENV } from './env.js';

const { Pool } = pg;

let pool;

export function isDbEnabled() {
    return Boolean(DATABASE_URL);
}

export function getPool() {
    if (!DATABASE_URL) {
        throw new Error('DATABASE_URL is not set');
    }

    if (!pool) {
        pool = new Pool({
            connectionString: DATABASE_URL,
            ssl: NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
        });
    }

    return pool;
}

export async function query(text, params) {
    const activePool = getPool();
    return activePool.query(text, params);
}

export async function initDb() {
    if (!isDbEnabled()) return false;

    await query('SELECT 1');

    await query(`
        CREATE TABLE IF NOT EXISTS users (
            id uuid PRIMARY KEY,
            email text NOT NULL UNIQUE,
            password_hash text NOT NULL,
            password_salt text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        );
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS sessions (
            id uuid PRIMARY KEY,
            user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at timestamptz NOT NULL DEFAULT now(),
            expires_at timestamptz NOT NULL
        );
    `);

    await query(`
        CREATE INDEX IF NOT EXISTS sessions_user_id_idx
        ON sessions (user_id);
    `);

    await query(`
        CREATE INDEX IF NOT EXISTS sessions_expires_at_idx
        ON sessions (expires_at);
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS subscriptions (
            id uuid PRIMARY KEY,
            user_id uuid REFERENCES users(id) ON DELETE CASCADE,
            name text NOT NULL,
            price_cents integer NOT NULL CHECK (price_cents >= 0),
            currency text NOT NULL DEFAULT 'USD',
            cadence text NOT NULL CHECK (cadence IN ('monthly', 'yearly')),
            next_billing_date date NOT NULL,
            status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled')),
            canceled_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );
    `);

    await query(`
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'subscriptions'
                  AND column_name = 'user_id'
                  AND data_type = 'text'
            ) THEN
                UPDATE subscriptions
                SET user_id = NULL
                WHERE user_id IS NOT NULL
                  AND user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

                ALTER TABLE subscriptions
                ALTER COLUMN user_id TYPE uuid
                USING NULLIF(user_id, '')::uuid;
            END IF;

            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'subscriptions_user_id_fkey'
            ) THEN
                ALTER TABLE subscriptions
                ADD CONSTRAINT subscriptions_user_id_fkey
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
            END IF;
        END $$;
    `);

    await query(`
        CREATE INDEX IF NOT EXISTS subscriptions_user_id_idx
        ON subscriptions (user_id);
    `);

    await query(`
        CREATE INDEX IF NOT EXISTS subscriptions_status_idx
        ON subscriptions (status);
    `);

    await query(`
        CREATE INDEX IF NOT EXISTS subscriptions_next_billing_date_idx
        ON subscriptions (next_billing_date);
    `);

    return true;
}
