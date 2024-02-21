import test from "ava"
import { QueryResult } from "pg"
import { getTestPostgresDatabaseFactory } from "~/index"

test("pgbouncer", async (t) => {
  const getPostgres13 = getTestPostgresDatabaseFactory({
    postgresVersion: "13.5",
    pgbouncer: {
      enabled: true,
      version: "1.22.0",
      poolMode: "statement",
    },
  })

  const postgres13 = await getPostgres13(t)

  t.truthy(postgres13.pgbouncerConnectionString)
  const result = await postgres13.pool.query("SELECT 1 as result")

  t.is(result.rows[0].result, 1)

  // can't use a transaction with statement pool mode
  const err = await t.throwsAsync(postgres13.pool.query(`BEGIN TRANSACTION`))

  t.truthy(
    err!
      .toString()
      .includes("transaction blocks not allowed in statement pooling mode")
  )
})
