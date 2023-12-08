import test from "ava"
import { getTestPostgresDatabaseFactory } from "~/index"

const getTestServer = getTestPostgresDatabaseFactory({
  postgresVersion: process.env.POSTGRES_VERSION,
})

test("create database", async (t) => {
  await getTestServer(t)
  t.pass()
})
