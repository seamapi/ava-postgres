import test from "ava"
import { getTestPostgresDatabaseFactory } from "~/index"

const getTestDatabase = getTestPostgresDatabaseFactory({
  key: "keyed-across-workers",
})

test("keyed returns same database across workers (2/2)", async (t) => {
  const database = await getTestDatabase(null, {
    key: "foo",
  })

  console.log("connectionString:", database.connectionString)

  t.pass()
})
