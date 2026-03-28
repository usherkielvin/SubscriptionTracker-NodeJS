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

subscriptionsRouter.post('/', async (req, res, next) => {
    try {
        const { userId, name, priceCents, currency, cadence, nextBillingDate } = req.body ?? {};

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
        if (userId !== undefined && !isNonEmptyString(userId)) {
            return res.status(400).send({ error: 'userId must be a non-empty string' });
        }

        const id = randomUUID();

        const result = await query(
            `
                INSERT INTO subscriptions (id, user_id, name, price_cents, currency, cadence, next_billing_date)
                VALUES ($1, $2, $3, $4, COALESCE($5, 'USD'), $6, $7)
                RETURNING *
            `,
            [id, userId ?? null, name.trim(), priceCents, currency ?? null, cadence, nextBillingDate]
        );

        return res.status(201).send({ subscription: toSubscription(result.rows[0]) });
    } catch (err) {
        return next(err);
    }
});

subscriptionsRouter.get('/', async (req, res, next) => {
    try {
        const { userId, status } = req.query ?? {};

        const values = [];
        const where = [];

        if (userId !== undefined) {
            if (!isNonEmptyString(userId)) return res.status(400).send({ error: 'userId must be a non-empty string' });
            values.push(userId);
            where.push(`user_id = $${values.length}`);
        }

        if (status !== undefined) {
            if (!isStatus(status)) return res.status(400).send({ error: "status must be 'active' or 'canceled'" });
            values.push(status);
            where.push(`status = $${values.length}`);
        }

        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

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

        const result = await query(`SELECT * FROM subscriptions WHERE id = $1`, [id]);
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
        const { userId, name, priceCents, currency, cadence, nextBillingDate, status } = req.body ?? {};

        const sets = [];
        const values = [];

        if (userId !== undefined) {
            if (userId !== null && !isNonEmptyString(userId)) {
                return res.status(400).send({ error: 'userId must be a non-empty string or null' });
            }
            values.push(userId);
            sets.push(`user_id = $${values.length}`);
        }

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
        const result = await query(
            `
                UPDATE subscriptions
                SET ${sets.join(', ')}, updated_at = now()
                WHERE id = $${values.length}
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

        const result = await query(
            `
                UPDATE subscriptions
                SET status = 'canceled', canceled_at = COALESCE(canceled_at, now()), updated_at = now()
                WHERE id = $1
                RETURNING *
            `,
            [id]
        );

        const row = result.rows[0];
        if (!row) return res.status(404).send({ error: 'Subscription not found' });

        return res.send({ subscription: toSubscription(row) });
    } catch (err) {
        return next(err);
    }
});

export default subscriptionsRouter;
