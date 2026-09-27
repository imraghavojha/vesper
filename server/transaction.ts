import type { DatabaseSync } from "node:sqlite";

// Store operations are synchronous. Do not hold a transaction across an await.
export function transaction<T>(database: DatabaseSync, operation: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    if (database.isTransaction) {
      try {
        database.exec("ROLLBACK");
      } catch {
        /* Preserve the original storage failure. */
      }
    }
    throw error;
  }
}
