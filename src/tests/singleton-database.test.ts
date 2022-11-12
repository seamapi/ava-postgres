import test from "ava"
import { getTestPostgresDatabaseFactory } from "~/index"

test("useSingletonDatabase", async (t) => {
  const getTestDatabase = getTestPostgresDatabaseFactory({
    postgresVersion: process.env.POSTGRES_VERSION,
    key: "useSingletonDatabase",
    useSingletonDatabase: true,
  })

  const database1 = await getTestDatabase()
  const database2 = await getTestDatabase()

  t.is(database1.connectionString, database2.connectionString)
})

test("useSingletonDatabase (defaults to false)", async (t) => {
  const getTestDatabase = getTestPostgresDatabaseFactory({
    postgresVersion: process.env.POSTGRES_VERSION,
    key: "useSingletonDatabaseFalse",
  })

  const database1 = await getTestDatabase()
  const database2 = await getTestDatabase()

  t.not(database1.connectionString, database2.connectionString)
})

test("useSingletonDatabase (works with hooks)", async (t) => {
  let wasHookCalled = false

  type TestFactoryParams = {
    tableName: string
  }

  const getTestDatabase = getTestPostgresDatabaseFactory<TestFactoryParams>({
    postgresVersion: process.env.POSTGRES_VERSION,
    key: "useSingletonDatabaseHook",
    useSingletonDatabase: true,
    beforeTemplateIsBaked: async ({
      connection: { pool },
      params: { tableName },
    }) => {
      wasHookCalled = true
      await pool.query(`CREATE TABLE "${tableName}" ("id" SERIAL PRIMARY KEY)`)
    },
  })

  const { pool } = await getTestDatabase({ tableName: "foo" })

  t.true(wasHookCalled)
  await t.notThrowsAsync(async () => await pool.query('SELECT * FROM "foo"'))
})
