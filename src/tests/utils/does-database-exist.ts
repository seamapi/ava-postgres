import { Pool } from "pg"

export const doesDatabaseExist = async (pool: Pool, databaseName: string) => {
  const {
    rows: [{ count }],
  } = await pool.query(
    'SELECT COUNT(*) FROM "pg_database" WHERE "datname" = $1',
    [databaseName]
  )

  return count > 0
}
