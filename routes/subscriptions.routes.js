import { randomUUID } from 'node:crypto';

import { Router } from 'express';

import { isDbEnabled, query } from '../config/db.js';

const subscriptionsRouter = Router();

subscriptionsRouter.use((req, res, next) => {
    if (!isDbEnabled()) {
        return res.status(503).send({
            error: 'Database not configured',
            hint: 'Set DATABASE_URL (e.g. postgres://user:pass@localhost:5432/subtracker)',
        });
    }
    return next();
});

subscriptionsRouter.use((req, res, next) => {
    if (!req.user?.id) return res.status(401).send({ error: 'Unauthorized' });
    return next();
});

function toSubscription(row) {
    return {
        id: row.id,
        userId: row.user_id,
        name: row.name,
        priceCents: row.price_cents,
        currency: row.currency,
        cadence: row.cadence,
        nextBillingDate: row.next_billing_date,
        status: row.status,
        canceledAt: row.canceled_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function isCadence(value) {
    return value === 'monthly' || value === 'yearly';
}

function isStatus(value) {
    return value === 'active' || value === 'canceled';
}

function isIsoDate(value) {
    if (!isNonEmptyString(value)) return false;
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isUuid(value) {
    if (!isNonEmptyString(value)) return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

subscriptionsRouter.post('/', async (req, res, next) => {
    try {
        const { name, priceCents, currency, cadence, nextBillingDate } = req.body ?? {};

        if (!isNonEmptyString(name)) {
            return res.status(400).send({ error: 'name is required' });
        }
        if (!Number.isInteger(priceCents) || priceCents < 0) {
            return res.status(400).send({ error: 'priceCents must be a non-negative integer' });
        }
        if (!isCadence(cadence)) {
            return res.status(400).send({ error: "cadence must be 'monthly' or 'yearly'" });
        }
        if (!isIsoDate(nextBillingDate)) {
            return res.status(400).send({ error: 'nextBillingDate must be YYYY-MM-DD' });
        }
        if (currency !== undefined && !isNonEmptyString(currency)) {
            return res.status(400).send({ error: 'currency must be a non-empty string' });
        }

        const id = randomUUID();
        const userId = req.user?.id;

        const result = await query(
            `
                INSERT INTO subscriptions (id, user_id, name, price_cents, currency, cadence, next_billing_date)
                VALUES ($1, $2, $3, $4, COALESCE($5, 'USD'), $6, $7)
                RETURNING *
            `,
            [id, userId, name.trim(), priceCents, currency ?? null, cadence, nextBillingDate]
        );

        return res.status(201).send({ subscription: toSubscription(result.rows[0]) });
    } catch (err) {
        return next(err);
    }
});

subscriptionsRouter.get('/', async (req, res, next) => {
    try {
        const { status } = req.query ?? {};
        const userId = req.user?.id;

        const values = [userId];
        const where = ['user_id = $1'];

        if (status !== undefined) {
            if (!isStatus(status)) return res.status(400).send({ error: "status must be 'active' or 'canceled'" });
            values.push(status);
            where.push(`status = $${values.length}`);
        }

        const whereSql = `WHERE ${where.join(' AND ')}`;

        const result = await query(
            `
                SELECT *
                FROM subscriptions
                ${whereSql}
                ORDER BY next_billing_date ASC, created_at DESC
            `,
            values
        );

        return res.send({ subscriptions: result.rows.map(toSubscription) });
    } catch (err) {
        return next(err);
    }
});

subscriptionsRouter.get('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;

        if (!isUuid(id)) return res.status(400).send({ error: 'Invalid subscription id' });

        const result = await query(`SELECT * FROM subscriptions WHERE id = $1 AND user_id = $2`, [id, userId]);
        const row = result.rows[0];

        if (!row) return res.status(404).send({ error: 'Subscription not found' });

        return res.send({ subscription: toSubscription(row) });
    } catch (err) {
        return next(err);
    }
});

subscriptionsRouter.post('/:id/pay', async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;

        if (!isUuid(id)) return res.status(400).send({ error: 'Invalid subscription id' });

        const result = await query(
            `
                UPDATE subscriptions
                SET
                    next_billing_date =
                        CASE
                            WHEN cadence = 'monthly' THEN (next_billing_date + INTERVAL '1 month')::date
                            ELSE (next_billing_date + INTERVAL '1 year')::date
                        END,
                    updated_at = now()
                WHERE id = $1 AND user_id = $2 AND status = 'active'
                RETURNING *
            `,
            [id, userId]
        );

        const row = result.rows[0];
        if (!row) return res.status(404).send({ error: 'Subscription not found' });

        return res.send({ subscription: toSubscription(row) });
    } catch (err) {
        return next(err);
    }
});

subscriptionsRouter.patch('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, priceCents, currency, cadence, nextBillingDate, status } = req.body ?? {};
        const userId = req.user?.id;

        if (!isUuid(id)) return res.status(400).send({ error: 'Invalid subscription id' });

        const sets = [];
        const values = [];

        if (name !== undefined) {
            if (!isNonEmptyString(name)) return res.status(400).send({ error: 'name must be a non-empty string' });
            values.push(name.trim());
            sets.push(`name = $${values.length}`);
        }

        if (priceCents !== undefined) {
            if (!Number.isInteger(priceCents) || priceCents < 0) {
                return res.status(400).send({ error: 'priceCents must be a non-negative integer' });
            }
            values.push(priceCents);
            sets.push(`price_cents = $${values.length}`);
        }

        if (currency !== undefined) {
            if (currency !== null && !isNonEmptyString(currency)) {
                return res.status(400).send({ error: 'currency must be a non-empty string or null' });
            }
            values.push(currency);
            sets.push(`currency = COALESCE($${values.length}, currency)`);
        }

        if (cadence !== undefined) {
            if (!isCadence(cadence)) return res.status(400).send({ error: "cadence must be 'monthly' or 'yearly'" });
            values.push(cadence);
            sets.push(`cadence = $${values.length}`);
        }

        if (nextBillingDate !== undefined) {
            if (!isIsoDate(nextBillingDate)) return res.status(400).send({ error: 'nextBillingDate must be YYYY-MM-DD' });
            values.push(nextBillingDate);
            sets.push(`next_billing_date = $${values.length}`);
        }

        if (status !== undefined) {
            if (!isStatus(status)) return res.status(400).send({ error: "status must be 'active' or 'canceled'" });
            values.push(status);
            sets.push(`status = $${values.length}`);
            if (status === 'canceled') {
                sets.push(`canceled_at = now()`);
            }
        }

        if (!sets.length) return res.status(400).send({ error: 'No valid fields to update' });

        values.push(id);
        values.push(userId);
        const result = await query(
            `
                UPDATE subscriptions
                SET ${sets.join(', ')}, updated_at = now()
                WHERE id = $${values.length - 1} AND user_id = $${values.length}
                RETURNING *
            `,
            values
        );

        const row = result.rows[0];
        if (!row) return res.status(404).send({ error: 'Subscription not found' });

        return res.send({ subscription: toSubscription(row) });
    } catch (err) {
        return next(err);
    }
});

subscriptionsRouter.delete('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;

        if (!isUuid(id)) return res.status(400).send({ error: 'Invalid subscription id' });

        const result = await query(
            `
                UPDATE subscriptions
                SET status = 'canceled', canceled_at = COALESCE(canceled_at, now()), updated_at = now()
                WHERE id = $1 AND user_id = $2
                RETURNING *
            `,
            [id, userId]
        );

        const row = result.rows[0];
        if (!row) return res.status(404).send({ error: 'Subscription not found' });

        return res.send({ subscription: toSubscription(row) });
    } catch (err) {
        return next(err);
    }
});

export default subscriptionsRouter;
