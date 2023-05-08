import test from "ava"
import { getTestPostgresDatabaseFactory } from "~/index"

const getTestDatabase = getTestPostgresDatabaseFactory({
  shared_database_dedupe_key: "keyed-across-workers",
})

test("keyed returns same database across workers (2/2)", async (t) => {
  const database = await getTestDatabase(null, {
    shared_worker_name: "foo",
  })

  console.log("connectionString:", database.connectionString)

  t.pass()
})
