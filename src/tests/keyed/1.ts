import test from "ava"
import { getTestPostgresDatabaseFactory } from "~/index"

const getTestDatabase = getTestPostgresDatabaseFactory({
  workerDedupeKey: "keyed-across-workers",
})

test("keyed returns same database across workers (1/2)", async (t) => {
  const database = await getTestDatabase(t, null, {
    databaseDedupeKey: "foo",
  })

  console.log("connectionString:", database.connectionString)

  t.pass()
})
