import { Router } from 'express';

import crypto from 'node:crypto';

import { isDbEnabled, query } from '../config/db.js';
import { clearSessionCookie, createSession, getAuthUser, hashPassword, setSessionCookie, verifyPassword } from '../middleware/auth.js';

const authRouter = Router();

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

authRouter.use((req, res, next) => {
    if (!isDbEnabled()) {
        return res.status(503).send({
            error: 'Database not configured',
            hint: 'Set DATABASE_URL (e.g. postgres://user:pass@localhost:5432/subtracker)',
        });
    }
    return next();
});

authRouter.get('/me', async (req, res, next) => {
    try {
        const user = await getAuthUser(req);
        if (!user) return res.status(401).send({ error: 'Unauthorized' });
        return res.send({ user: { id: user.id, email: user.email } });
    } catch (err) {
        return next(err);
    }
});

authRouter.post('/sign-up', async (req, res, next) => {
    try {
        const { email, password } = req.body ?? {};

        if (!isNonEmptyString(email)) return res.status(400).send({ error: 'email is required' });
        if (!isNonEmptyString(password) || password.length < 8) {
            return res.status(400).send({ error: 'password must be at least 8 characters' });
        }

        const normalizedEmail = email.trim().toLowerCase();

        const exists = await query('SELECT 1 FROM users WHERE email = $1', [normalizedEmail]);
        if (exists.rowCount) return res.status(409).send({ error: 'Email already in use' });

        const { hashBase64, saltBase64 } = await hashPassword(password);
        const userId = crypto.randomUUID();

        await query(
            `
                INSERT INTO users (id, email, password_hash, password_salt)
                VALUES ($1, $2, $3, $4)
            `,
            [userId, normalizedEmail, hashBase64, saltBase64]
        );

        const { sessionId } = await createSession({ userId });
        setSessionCookie(res, sessionId);

        return res.status(201).send({ user: { id: userId, email: normalizedEmail } });
    } catch (err) {
        return next(err);
    }
});

authRouter.post('/sign-in', async (req, res, next) => {
    try {
        const { email, password } = req.body ?? {};

        if (!isNonEmptyString(email)) return res.status(400).send({ error: 'email is required' });
        if (!isNonEmptyString(password)) return res.status(400).send({ error: 'password is required' });

        const normalizedEmail = email.trim().toLowerCase();

        const result = await query(
            `
                SELECT id, email, password_hash, password_salt
                FROM users
                WHERE email = $1
            `,
            [normalizedEmail]
        );

        const user = result.rows[0];
        if (!user) return res.status(401).send({ error: 'Invalid credentials' });

        const ok = await verifyPassword({
            password,
            hashBase64: user.password_hash,
            saltBase64: user.password_salt,
        });

        if (!ok) return res.status(401).send({ error: 'Invalid credentials' });

        const { sessionId } = await createSession({ userId: user.id });
        setSessionCookie(res, sessionId);

        return res.send({ user: { id: user.id, email: user.email } });
    } catch (err) {
        return next(err);
    }
});

authRouter.post('/sign-out', async (req, res, next) => {
    try {
        const sid = req.cookies?.sid;
        if (isNonEmptyString(sid)) {
            await query('DELETE FROM sessions WHERE id = $1', [sid]);
        }
        clearSessionCookie(res);
        return res.send({ ok: true });
    } catch (err) {
        return next(err);
    }
});

export default authRouter;
