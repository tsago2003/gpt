import { Pool, PoolConfig } from "pg";
import { logger } from "../logger/logger";

// Database Configuration
const dbConfig: PoolConfig = {
  host: "database-2.cb24okyu4qtz.eu-north-1.rds.amazonaws.com",
  database: process.env.DB_NAME || "postgres",
  user: "postgres",
  password: "6HFRKfBMGyHctqLtcXIL",
  port: parseInt(process.env.DB_PORT || "5432"),
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false, // Enable SSL if DB_SSL is true
};

const dbPool = new Pool(dbConfig);

async function setupDatabase() {
  let adminConn = null;
  let conn = null;

  try {
    // First connect to the default postgres database
    adminConn = new Pool({
      host: dbConfig.host,
      database: "postgres",
      user: dbConfig.user,
      password: dbConfig.password,
      port: dbConfig.port,
    });

    // Check if database exists, create if it doesn't
    const dbCheck = await adminConn.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [dbConfig.database]
    );

    if (dbCheck.rowCount === 0) {
      await adminConn.query(`CREATE DATABASE ${dbConfig.database}`);
      logger.info(`Database ${dbConfig.database} created`);
    }

    // Connect to our specific database
    conn = new Pool(dbConfig);

    // await adminConn.query("DROP TABLE summaries");

    // Create table if it doesn't exist
    await conn.query(`
      CREATE TABLE IF NOT EXISTS summaries (
        task_id VARCHAR(255) PRIMARY KEY,
        video_id VARCHAR(255) NOT NULL,
        video_link TEXT NOT NULL,
        model VARCHAR(50) NOT NULL,
        summary_language VARCHAR(50) NOT NULL,
        title TEXT,
        transcript TEXT,
        summary TEXT,
        emoji VARCHAR(10),
        status VARCHAR(20) NOT NULL,
        lengthInSeconds VARCHAR(255),
        error TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    logger.info("Database setup completed");
  } catch (error: any) {
    logger.error(`Database setup error: ${error.message}`);
    throw error;
  } finally {
    if (adminConn) await adminConn.end();
    if (conn) await conn.end();
  }
}

setupDatabase()
  .then(() => logger.info("Database initialization complete"))
  .catch((err) => logger.error("Database initialization failed", err));
// --------------------------
// Database Connection Helper
// --------------------------
export async function getDbConnection(): Promise<any> {
  return await dbPool.connect();
}
