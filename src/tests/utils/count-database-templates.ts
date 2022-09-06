import { Pool } from "pg"

const NUM_OF_DEFAULT_POSTGRES_TEMPLATES = 2

export const countDatabaseTemplates = async (pool: Pool) => {
  const {
    rows: [{ count }],
  } = await pool.query(
    'SELECT COUNT(*) FROM "pg_database" WHERE "datistemplate" = true'
  )

  return count - NUM_OF_DEFAULT_POSTGRES_TEMPLATES
}
