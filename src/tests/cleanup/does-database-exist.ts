import test from "ava"
import pRetry from "p-retry"
import { getTestPostgresDatabaseFactory } from "~/index"

const getTestServer = getTestPostgresDatabaseFactory({
  postgresVersion: process.env.POSTGRES_VERSION,
})

const NUM_OF_DEFAULT_POSTGRES_DATABASES = 1

test("database that first test worker created should have been dropped", async (t) => {
  const { pool } = await getTestServer()

  await pRetry(
    async () => {
      const {
        rows: [{ count }],
      } = await pool.query(
        'SELECT COUNT(*) FROM "pg_database" WHERE "datistemplate" = false'
      )

      // (Add one since we create a database in this test)
      if (Number(count) !== NUM_OF_DEFAULT_POSTGRES_DATABASES + 1) {
        throw new Error("Database was not dropped")
      }
    },
    {
      minTimeout: 100,
      factor: 1,
      maxRetryTime: 30_000,
    }
  )

  t.pass()
})
