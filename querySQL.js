import pg from 'pg';
import dotenv from 'dotenv';
import path from "node:path";
import {fileURLToPath} from 'node:url';
 
// Set up dotenv to load environment variables from .env file
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

// Create a new PostgreSQL client using the connection details from environment variables

const {Client} = pg;

const client = new Client({
    host: process.env.DB_host,
    port: process.env.DB_port,
    user: process.env.DB_user,
    password: process.env.DB_password,
    database: process.env.DB_name,
    connectionTimeoutMillis: 6000000, //Set a connection timeout (in milliseconds)
});

//Declaring variables used for query where clause. Will be replaced with calander option later
const newestDate = '2026-10-01'; //Used for 
const timeStamp = '08/19/2026'; //Used for treatment query


// The key that stores the table content is defined and the parameters fore the query is added to text and values
const queriesSensors = {
    //First adding treatment tables query parameters
    treatment2_p1: {
        text: 'SELECT * FROM "treatment 2_Port1" WHERE timestamps = $1',
        values: [timeStamp]
    }, 
    treatment2_p2: {
        text: 'SELECT * FROM "treatment 2_Port2" WHERE timestamps = $1',
        values: [timeStamp]
    }, 
    treatment2_p3: {
        text: 'SELECT * FROM "treatment 2_Port3" WHERE timestamps = $1',
        values: [timeStamp]
    }, 
    treatment2_p4: {
        text: 'SELECT * FROM "treatment 2_Port4" WHERE timestamps = $1',
        values: [timeStamp]
    }, 
    treatment3_p1: {
        text: 'SELECT * FROM "Treatment 3_port1" WHERE timestamps = $1',
        values: [timeStamp]
    }, 
    treatment3_p2: {
        text: 'SELECT * FROM "Treatment 3_port2" WHERE timestamps = $1',
        values: [timeStamp]
    }, 

    //Next adding chameleon sensor table query parameters
    chameleon_010A: {
        text: 'SELECT * FROM "chameleon_010A" WHERE time >= $1',
        values: [newestDate]
    },
    chameleon_09CC: {
        text: 'SELECT * FROM "chameleon_09CC" WHERE time >= $1',
        values: [newestDate]
    },
    chameleon_7AD3: {
        text: 'SELECT * FROM "chameleon_7AD3" WHERE time >= $1',
        values: [newestDate]
    },
    chameleon_8AB2: {
        text: 'SELECT * FROM "chameleon_8AB2" WHERE time >= $1',
        values: [newestDate]
    },
    chameleon_19DD: {
        text: 'SELECT * FROM "chameleon_19DD" WHERE time >= $1',
        values: [newestDate]
    },
    chameleon_34CC: {
        text: 'SELECT * FROM "chameleon_34CC" WHERE time >= $1',
        values: [newestDate]
    },
    chameleon_77E5: {
        text: 'SELECT * FROM "chameleon_77E5" WHERE time >= $1',
        values: [newestDate]
    },
    chameleon_712B: {
        text: 'SELECT * FROM "chameleon_712B" WHERE time >= $1',
        values: [newestDate]
    },
    chameleon_1184: {
        text: 'SELECT * FROM "chameleon_1184" WHERE time >= $1',
        values: [newestDate]
    },
    chameleon_9387: {
        text: 'SELECT * FROM "chameleon_9387" WHERE time >= $1',
        values: [newestDate]
    },
    chameleon_B779: {
        text: 'SELECT * FROM "chameleon_B779" WHERE time >= $1',
        values: [newestDate]
    },
    chameleon_C2BA: {
        text: 'SELECT * FROM "chameleon_C2BA" WHERE time >= $1',
        values: [newestDate]
    },
    chameleon_D967: {
        text: 'SELECT * FROM "chameleon_D967" WHERE time >= $1',
        values: [newestDate]
    },
    chameleon_EDD5: {
        text: 'SELECT * FROM "chameleon_EDD5" WHERE time >= $1',
        values: [newestDate]
    }, 
    // Next adding water level sensor table query
    waterSensor_level1: {
        text: 'SELECT record, date, "loc time", level1 FROM water_sensors_data',
        values: []
    }, 
    waterSensor_level2: {
        text: 'SELECT record, date, "loc time", level2 FROM water_sensors_data',
        values: []
    },
};

// Creating query function that gets the data 
async function querySensorTables(client) {
    const results = {};
    for (const [key, { text, values }] of Object.entries(queriesSensors)) {
        const { rows } = await client.query(text, values);
        results[key] = rows;
    }
    return results;
}

/*The code below "getSensorData" is an exported function that is used in the dashboard and cesium code*/

export async function getSensorData() {
    await client.connect();
    try {
        return await querySensorTables(client);
    } finally {
        await client.end();
    }
}

/* The code below should be added to the cesium js and dashboard js
The code can be accessed using db_sensorData.key[row index starting from 0]
e.g. to access waterSensor_level2, row 1 entry => db_sensorData.waterSensor_level2[0]
*/
/*
import { getDbData } from './querySQL.js';

const db_senorData = await getSensorData();
*/


/*The code below 'async function main() and call of main()' is for testing purposes*/
/*
async function main() {
    await client.connect();
    try {
        const db_data = await querySensorTables(client);
        console.log(db_data.waterSensor_level1);
        return db_data;
    } finally {
        await client.end();
    }
}

main().catch((error) => {
    console.error(`${new Date().toISOString()} - Database query failed:`, error);
    process.exitCode = 1;
});
*/
