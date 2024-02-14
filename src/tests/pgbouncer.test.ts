import test from "ava"
import { QueryResult } from "pg"
import { getTestPostgresDatabaseFactory } from "~/index"

test("works with multiple versions", async (t) => {
  const getPostgres13 = getTestPostgresDatabaseFactory({
    postgresVersion: "13.5",
  })

  const postgres13 = await getPostgres13(t)

  const parseVersion = (result: QueryResult) => {
    const {
      rows: [{ version }],
    } = result
    return version.split(" ")[1]
  }

  t.is(parseVersion(await postgres13.pool.query("SELECT version()")), "13.5")
  t.is(parseVersion(await postgres14.pool.query("SELECT version()")), "14.5")
})
