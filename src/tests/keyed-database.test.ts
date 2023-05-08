import test from "ava"
import { getTestPostgresDatabaseFactory } from "~/index"

test("keyed", async (t) => {
  const getTestDatabase = getTestPostgresDatabaseFactory({
    postgresVersion: process.env.POSTGRES_VERSION,
    shared_database_dedupe_key: "keyed",
  })

  const [database1, database2] = await Promise.all([
    getTestDatabase(null, {
      shared_worker_name: "foo",
    }),
    getTestDatabase(null, {
      shared_worker_name: "foo",
    }),
  ])

  t.is(database1.connectionString, database2.connectionString)
})

test("defaults to different databases", async (t) => {
  const getTestDatabase = getTestPostgresDatabaseFactory({
    postgresVersion: process.env.POSTGRES_VERSION,
    shared_database_dedupe_key: "notKeyedByDefault",
  })

  const [database1, database2, database3] = await Promise.all([
    getTestDatabase(null, {
      shared_worker_name: "foo",
    }),
    getTestDatabase(null, {
      shared_worker_name: "foo",
    }),
    getTestDatabase(),
  ])

  t.is(database1.connectionString, database2.connectionString)
  t.not(database1.connectionString, database3.connectionString)
})

test("works with hooks", async (t) => {
  let wasHookCalled = false

  type TestFactoryParams = {
    tableName: string
  }

  const getTestDatabase = getTestPostgresDatabaseFactory<TestFactoryParams>({
    postgresVersion: process.env.POSTGRES_VERSION,
    shared_database_dedupe_key: "keyedWithHook",
    beforeTemplateIsBaked: async ({
      connection: { pool },
      params: { tableName },
    }) => {
      wasHookCalled = true
      await pool.query(`CREATE TABLE "${tableName}" ("id" SERIAL PRIMARY KEY)`)
    },
  })

  const { pool } = await getTestDatabase(
    { tableName: "foo" },
    {
      shared_worker_name: "foo",
    }
  )

  t.true(wasHookCalled)
  await t.notThrowsAsync(async () => await pool.query('SELECT * FROM "foo"'))

  const [database1, database2, database3] = await Promise.all([
    getTestDatabase(
      { tableName: "foo" },
      {
        shared_worker_name: "foo",
      }
    ),
    getTestDatabase(
      { tableName: "foo" },
      {
        shared_worker_name: "foo",
      }
    ),
    getTestDatabase(
      { tableName: "bar" },
      {
        shared_worker_name: "foo",
      }
    ),
  ])

  t.is(database1.connectionString, database2.connectionString)
  t.not(database1.connectionString, database3.connectionString)

  await t.notThrowsAsync(
    async () => await database3.pool.query('SELECT * FROM "bar"')
  )
})
