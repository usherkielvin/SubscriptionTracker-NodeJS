import fs from 'node:fs';

import { config } from 'dotenv';

const env = process.env.NODE_ENV || 'development';

const envFiles = [`.env.${env}.local`, '.env.local', '.env'];

for (const file of envFiles) {
    if (fs.existsSync(file)) {
        config({ path: file });
    }
}

export const { PORT, NODE_ENV, DATABASE_URL } = process.env;
