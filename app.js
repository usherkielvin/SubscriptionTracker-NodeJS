import express from 'express';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';

import { PORT } from './config/env.js';
import { initDb } from './config/db.js';
import routes from './routes/index.js';

const app = express();

app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

app.get('/', (req, res) => {
    res.send({ name: 'SubsTracker', status: 'running' });
});

app.use('/api', routes);

app.use((req, res) => {
    res.status(404).send({ error: 'Not Found' });
});

app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    console.error(err);
    return res.status(500).send({ error: 'Internal Server Error' });
});

const port = Number(PORT) || 3000;

const start = async () => {
    const dbReady = await initDb();
    if (!dbReady) {
        console.warn('DATABASE_URL is not set. Subscription endpoints will return 503 until configured.');
    }
    app.listen(port, () => {
        console.log(`Server is running on http://localhost:${port}`);
    });
};

start().catch((err) => {
    console.error(err);
    process.exit(1);
});

export default app;
