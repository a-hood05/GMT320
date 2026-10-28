import pg from 'pg';
import dotenv from 'dotenv';
import path from "node:path";
import {fileURLToPath} from 'node:url';
 
// Set up dotenv to load environment variables from .env file
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

// Create a new PostgreSQL client using the connection details from environment variables

const {Client} = pg;

const client = new Client({
    host: process.env.DB_host,
    port: process.env.DB_port,
    user: process.env.DB_user,
    password: process.env.DB_password,
    database: process.env.DB_name,
    connectionTimeoutMillis: 12000000, //Set a connection timeout (in milliseconds)
});

async function requestTreatment3_1() {
    const treatment3_1 = await client.query(`SELECT * FROM Treatment 3_port1`);
    return treatment3_1;
}

async function main() {
    await client.connect();
    try {
        await requestTreatment3_1();
        console.log(`${new Date().toISOString()} - Query request treatment succeeded `);
        return treatment3_1;
    } catch (error) {
        throw error;
    } finally {
        await client.end();
    }
}

main().catch((error) => {
    console.error(`${new Date().toISOString()} - Database query failed:`, error.message);
});