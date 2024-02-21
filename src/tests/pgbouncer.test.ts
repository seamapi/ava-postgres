import test from "ava"
import { QueryResult } from "pg"
import { getTestPostgresDatabaseFactory } from "~/index"

test("pgbouncer", async (t) => {
  const getPostgres13 = getTestPostgresDatabaseFactory({
    postgresVersion: "13.5",
    pgbouncer: {
      enabled: true,
      version: "1.22.0",
    },
  })

  const postgres13 = await getPostgres13(t)

  t.truthy(postgres13.pgbouncerConnectionString)
})
