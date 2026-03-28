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
        CREATE TABLE IF NOT EXISTS subscriptions (
            id uuid PRIMARY KEY,
            user_id text,
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
