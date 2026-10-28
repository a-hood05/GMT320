// =====================================================================
// Quick database check:  npm run dbcheck
// Lists every table with its columns, row count and time range, and checks
// that every sensor in sensor_tables.js points to a table that exists.
// Paste the output to the team chat if something doesn't line up.
// =====================================================================
import pg from "pg";
import { DB_CONFIG, q, timeSql } from "./server.js";
import { SENSOR_TABLES } from "./sensor_tables.js";

const client = new pg.Client(DB_CONFIG);

try {
  await client.connect();
  console.log(`Connected to ${DB_CONFIG.database} on ${DB_CONFIG.host}\n`);

  const { rows: cols } = await client.query(`
    SELECT table_schema, table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'topology', 'tiger')
    ORDER BY table_schema, table_name, ordinal_position`);

  const tables = {};
  for (const c of cols) {
    const key = c.table_schema === "public" ? c.table_name : `${c.table_schema}.${c.table_name}`;
    (tables[key] ||= []).push(`${c.column_name} (${c.data_type})`);
  }

  for (const [name, columns] of Object.entries(tables)) {
    let count = "?";
    try { count = (await client.query(`SELECT count(*)::int AS n FROM ${q(name)}`)).rows[0].n; } catch {}
    console.log(`${name}  [${count} rows]`);
    console.log(`   ${columns.join(", ")}`);
  }

  console.log("\nSensors linked in sensor_tables.js:");
  for (const [id, cfg] of Object.entries(SENSOR_TABLES)) {
    try {
      const r = await client.query(`SELECT min(${timeSql(cfg)}) AS first, max(${timeSql(cfg)}) AS last, count(*)::int AS n FROM ${q(cfg.table)}`);
      const { first, last, n } = r.rows[0];
      console.log(`  OK   sensor ${id.padStart(2)} -> ${cfg.table}: ${n} rows, ${first?.toISOString?.() ?? first} to ${last?.toISOString?.() ?? last}`);
      const sample = (await client.query(`SELECT * FROM ${q(cfg.table)} LIMIT 1`)).rows[0];
      if (sample) console.log(`       sample row: ${JSON.stringify(sample)}`);
    } catch (err) {
      console.log(`  FAIL sensor ${id.padStart(2)} -> ${cfg.table}: ${err.message}`);
    }
  }
} catch (err) {
  console.error(`Could not connect: ${err.message}`);
  console.error("Check server/.env, and that this laptop is on the Tailscale network.");
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
