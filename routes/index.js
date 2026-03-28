import { Router } from 'express';

import authRouter from './auth.routes.js';
import subscriptionsRouter from './subscriptions.routes.js';
import userRouter from './user.routes.js';
import { isDbEnabled, query } from '../config/db.js';

const router = Router();

router.get('/health', (req, res) => {
    res.send({ status: 'ok' });
});

router.get('/test-db', async (req, res, next) => {
    try {
        if (!isDbEnabled()) {
            return res.status(503).send({
                ok: false,
                error: 'Database not configured',
                hint: 'Set DATABASE_URL (e.g. postgres://user:pass@localhost:5432/subtracker)',
            });
        }

        const result = await query('SELECT NOW() AS now');
        return res.send({ ok: true, time: result.rows[0].now });
    } catch (err) {
        return next(err);
    }
});

router.get('/summary', async (req, res, next) => {
    try {
        if (!isDbEnabled()) {
            return res.status(503).send({
                error: 'Database not configured',
                hint: 'Set DATABASE_URL (e.g. postgres://user:pass@localhost:5432/subtracker)',
            });
        }

        const { userId } = req.query ?? {};
        if (userId !== undefined && (typeof userId !== 'string' || userId.trim().length === 0)) {
            return res.status(400).send({ error: 'userId must be a non-empty string' });
        }

        const values = [];
        const where = [`status = 'active'`];

        if (userId !== undefined) {
            values.push(userId);
            where.push(`user_id = $${values.length}`);
        }

        const whereSql = `WHERE ${where.join(' AND ')}`;

        const totalsResult = await query(
            `
                SELECT
                    COALESCE(SUM(CASE WHEN cadence = 'monthly' THEN price_cents ELSE ROUND(price_cents / 12.0) END), 0)::int AS monthly_total_cents,
                    COALESCE(SUM(CASE WHEN cadence = 'yearly' THEN price_cents ELSE price_cents * 12 END), 0)::int AS yearly_total_cents
                FROM subscriptions
                ${whereSql}
            `,
            values
        );

        const upcoming7Result = await query(
            `
                SELECT id, user_id, name, price_cents, currency, cadence, next_billing_date
                FROM subscriptions
                ${whereSql}
                    AND next_billing_date >= CURRENT_DATE
                    AND next_billing_date < CURRENT_DATE + INTERVAL '7 days'
                ORDER BY next_billing_date ASC, created_at DESC
                LIMIT 50
            `,
            values
        );

        const upcoming30Result = await query(
            `
                SELECT id, user_id, name, price_cents, currency, cadence, next_billing_date
                FROM subscriptions
                ${whereSql}
                    AND next_billing_date >= CURRENT_DATE
                    AND next_billing_date < CURRENT_DATE + INTERVAL '30 days'
                ORDER BY next_billing_date ASC, created_at DESC
                LIMIT 100
            `,
            values
        );

        const totalsRow = totalsResult.rows[0] ?? { monthly_total_cents: 0, yearly_total_cents: 0 };

        const toUpcoming = (row) => ({
            id: row.id,
            userId: row.user_id,
            name: row.name,
            priceCents: row.price_cents,
            currency: row.currency,
            cadence: row.cadence,
            nextBillingDate: row.next_billing_date,
        });

        return res.send({
            monthlyTotalCents: totalsRow.monthly_total_cents,
            yearlyTotalCents: totalsRow.yearly_total_cents,
            upcoming7Days: upcoming7Result.rows.map(toUpcoming),
            upcoming30Days: upcoming30Result.rows.map(toUpcoming),
        });
    } catch (err) {
        return next(err);
    }
});

router.use('/auth', authRouter);
router.use('/subscriptions', subscriptionsRouter);
router.use('/users', userRouter);

export default router;
