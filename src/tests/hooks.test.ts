import test from "ava"
import { getTestPostgresDatabaseFactory } from "~/index"

test("beforeTemplateIsBaked", async (t) => {
  let wasHookCalled = false

  interface TestFactoryParams {
    tableName: string
  }

  const getTestServer = getTestPostgresDatabaseFactory<TestFactoryParams>({
    key: "beforeTemplateIsBaked",
    hooks: {
      beforeTemplateIsBaked: async ({ pool }, { tableName }) => {
        wasHookCalled = true
        await pool.query(
          `CREATE TABLE "${tableName}" ("id" SERIAL PRIMARY KEY)`
        )
      },
    },
  })

  const { pool } = await getTestServer({ tableName: "foo" })

  t.true(wasHookCalled)
  await t.notThrowsAsync(async () => await pool.query('SELECT * FROM "foo"'))
})

test("beforeTemplateIsBaked (params are de-duped)", async (t) => {
  interface TestFactoryParams {
    tableName: string
  }

  const getTestServer = getTestPostgresDatabaseFactory<TestFactoryParams>({
    key: "beforeTemplateIsBakedDedupeParams",
    hooks: {
      beforeTemplateIsBaked: async ({ pool }, { tableName }) => {
        await pool.query(
          `CREATE TABLE "${tableName}" ("id" SERIAL PRIMARY KEY)`
        )
      },
    },
  })

  // Create first template
  await Promise.all([
    getTestServer({ tableName: "foo" }),
    // Re-use created template
    getTestServer({ tableName: "foo" }),
    // Create second template
    getTestServer({ tableName: "bar" }),
  ])

  const { pool } = await getTestServer({ tableName: "foo" })

  const {
    rows: [{ count }],
  } = await pool.query(
    'SELECT COUNT(*) FROM "pg_database" WHERE "datistemplate" = true'
  )

  const NUM_OF_DEFAULT_POSTGRES_TEMPLATES = 2

  t.is(parseInt(count, 10), NUM_OF_DEFAULT_POSTGRES_TEMPLATES + 2)
})
