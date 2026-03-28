import { promisify } from 'node:util';
import crypto from 'node:crypto';

import { NODE_ENV } from '../config/env.js';
import { isDbEnabled, query } from '../config/db.js';

const scryptAsync = promisify(crypto.scrypt);
const SESSION_COOKIE_NAME = 'sid';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

export async function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const derivedKey = await scryptAsync(password, salt, 64);

    return {
        hashBase64: Buffer.from(derivedKey).toString('base64'),
        saltBase64: salt.toString('base64'),
    };
}

export async function verifyPassword({ password, hashBase64, saltBase64 }) {
    const salt = Buffer.from(saltBase64, 'base64');
    const expected = Buffer.from(hashBase64, 'base64');
    const derivedKey = await scryptAsync(password, salt, expected.length);

    return crypto.timingSafeEqual(Buffer.from(derivedKey), expected);
}

export function setSessionCookie(res, sessionId) {
    res.cookie(SESSION_COOKIE_NAME, sessionId, {
        httpOnly: true,
        sameSite: 'lax',
        secure: NODE_ENV === 'production',
        maxAge: SESSION_TTL_MS,
    });
}

export function clearSessionCookie(res) {
    res.clearCookie(SESSION_COOKIE_NAME, {
        httpOnly: true,
        sameSite: 'lax',
        secure: NODE_ENV === 'production',
    });
}

export async function createSession({ userId }) {
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await query(
        `
            INSERT INTO sessions (id, user_id, expires_at)
            VALUES ($1, $2, $3)
        `,
        [sessionId, userId, expiresAt.toISOString()]
    );

    return { sessionId, expiresAt };
}

export async function getAuthUser(req) {
    const sid = req.cookies?.[SESSION_COOKIE_NAME];
    if (!isNonEmptyString(sid)) return null;

    const result = await query(
        `
            SELECT u.id, u.email, s.id AS session_id
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.id = $1 AND s.expires_at > NOW()
        `,
        [sid]
    );

    const row = result.rows[0];
    if (!row) return null;

    return { id: row.id, email: row.email, sessionId: row.session_id };
}

export async function requireAuth(req, res, next) {
    try {
        if (!isDbEnabled()) {
            return res.status(503).send({
                error: 'Database not configured',
                hint: 'Set DATABASE_URL (e.g. postgres://user:pass@localhost:5432/subtracker)',
            });
        }

        const user = await getAuthUser(req);
        if (!user) return res.status(401).send({ error: 'Unauthorized' });
        req.user = user;
        return next();
    } catch (err) {
        return next(err);
    }
}
