import test from "ava"
import { getTestPostgresDatabaseFactory } from "~/index"
import { countDatabaseTemplates } from "./utils/count-database-templates"

test("beforeTemplateIsBaked", async (t) => {
  let wasHookCalled = false

  type TestFactoryParams = {
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
  type TestFactoryParams = {
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
  // Should have created two templates
  t.is(await countDatabaseTemplates(pool), 2)
})

test("afterTemplateIsBaked", async (t) => {
  let wasHookCalled = false

  type TestFactoryParams = {
    tableName: string
  }

  const getTestServer = getTestPostgresDatabaseFactory<TestFactoryParams>({
    key: "afterTemplateIsBaked",
    hooks: {
      afterTemplateIsBaked: async ({ pool }, { tableName }) => {
        wasHookCalled = true
        await pool.query(
          `CREATE TABLE "${tableName}" ("id" SERIAL PRIMARY KEY)`
        )
      },
    },
  })

  const [{ pool }] = await Promise.all([
    getTestServer({ tableName: "foo" }),
    getTestServer({ tableName: "foo" }),
  ])

  t.true(wasHookCalled)
  await t.notThrowsAsync(async () => await pool.query('SELECT * FROM "foo"'))
  // At least one template is always created (since we don't know yet what params will be used)
  t.is(await countDatabaseTemplates(pool), 1)
})
