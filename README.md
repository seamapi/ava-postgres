# ava-postgres

`ava-postgres` is a test fixture for [AVA](https://github.com/avajs/ava) that provides you with nearly-instant access to a fresh Postgres database for every test.

`ava-postgres`'s only dependency is a running instance of Docker.

## Installation

```sh
npm install --save-dev ava-postgres
```

or

```sh
yarn add --dev ava-postgres
```

## Usage

`ava-postgres`'s main export is a factory function, so you'll probably want to create a file like `tests/fixtures/get-test-database.ts`:

```ts
import { getTestPostgresDatabaseFactory } from "ava-postgres"

export const getTestDatabase = getTestPostgresDatabaseFactory({
  // Any tag for the official Postgres Docker image, defaults to "14"
  postgresVersion: "14",
})
```

Then, in your tests, you can use the `getTestDatabase()` function to get a fresh database for each test:

```ts
import test from "ava"
import { getTestDatabase } from "./fixtures/get-test-database"

test("foo bar", async (t) => {
  const { pool } = await getTestDatabase()

  await pool.query("SELECT 1")

  t.pass()
})
```

[Full list of connection details returned by `getTestDatabase`](https://github.com/seamapi/ava-postgres/blob/e0de63b2d1f5562e33ae355848cf23bca08b82bb/src/public-types.ts#L6)

### Database setup

`ava-postgres` uses [Postgres templates](https://www.postgresql.org/docs/current/manage-ag-templatedbs.html) so you only pay the setup cost once. After a template has been created, Postgres can create a new database from it in milliseconds.

If you want to perform common database setup, you can use a hook and pass parameters to the `getTestDatabase()` function:

```ts
import { getTestPostgresDatabaseFactory } from "ava-postgres"

type GetTestDatabaseParams = {
  shouldMigrate?: boolean
  shouldSeed?: boolean
}

export const getTestDatabase =
  getTestPostgresDatabaseFactory<GetTestDatabaseParams>({
    beforeTemplateIsBaked: async ({
      connection: { pool },
      params: { shouldMigrate, shouldSeed },
    }) => {
      if (shouldMigrate) {
        await pool.query("CREATE TABLE foo (id int)")
      }

      if (shouldSeed) {
        await pool.query("INSERT INTO foo VALUES (1)")
      }
    },
  })
```

Then, in your tests, you can pass parameters to the `getTestDatabase()` function:

```ts
import test from "ava"
import { getTestDatabase } from "./fixtures/get-test-database"

test("foo bar", async (t) => {
  const { pool } = await getTestDatabase({
    shouldMigrate: true,
    shouldSeed: true,
  })

  await pool.query("SELECT * FROM foo")

  t.pass()
})
```

## Advanced Usage

### Postgres container de-duping

In rare cases, you may want to spawn more than one Postgres container.

Internally, this library uses an AVA "shared worker". A shared worker is a singleton shared with the entire running test suite, and so one `ava-postgres` shared worker maps to exactly one Postgres container.

To spawn separate shared workers and thus additional Postgres containers, you have two options:

**Specify different version strings for the `postgresVersion` option in the factory function**:

```ts
const getTestPostgresDatabase = getTestPostgresDatabaseFactory({
  postgresVersion: "14",
})
```

Each unique version will map to a unique shared worker.

**Set the `workerDedupeKey` option in the factory function**:

```ts
const getTestPostgresDatabase = getTestPostgresDatabaseFactory({
  workerDedupeKey: "foo",
})
```

Each unique key will map to a unique shared worker.

### Database de-duping

By default, `ava-postgres` will create a new database for each test. If you want to share a database between tests, you can use the `databaseDedupeKey` option:

```ts
import test from "ava"
const getTestPostgresDatabase = getTestPostgresDatabaseFactory({})

test("foo", async (t) => {
  const connection1 = await getTestPostgresDatabase(t, null, {
    databaseDedupeKey: "foo",
  })
  const connection2 = await getTestPostgresDatabase(t, null, {
    databaseDedupeKey: "foo",
  })
  t.is(connection1.database, connection2.database)
})
```

This works across the entire test suite.

Note that if unique parameters are passed to the `beforeTemplateIsBaked` (`null` in the above example), separate databases will still be created.

### "Nested" `beforeTemplateIsBaked` calls

In some cases, if you do extensive setup in your `beforeTemplateIsBaked` hook, you might want to obtain a separate, additional database within it if your application uses several databases for different purposes. This is possible by using the passed `beforeTemplateIsBaked` to your hook callback:

```ts
type DatabaseParams = {
  type: "foo" | "bar"
}

const getTestServer = getTestPostgresDatabaseFactory<DatabaseParams>({
  beforeTemplateIsBaked: async ({
    params,
    connection: { pool },
    beforeTemplateIsBaked,
  }) => {
    if (params.type === "foo") {
      await pool.query(`CREATE TABLE "foo" ("id" SERIAL PRIMARY KEY)`)
      // Important: return early to avoid infinite loop
      return
    }

    await pool.query(`CREATE TABLE "bar" ("id" SERIAL PRIMARY KEY)`)
    // This created database will be torn down at the end of the top-level `beforeTemplateIsBaked` call
    const fooDatabase = await beforeTemplateIsBaked({
      params: { type: "foo" },
    })

    // This works now
    await fooDatabase.pool.query(`INSERT INTO "foo" DEFAULT VALUES`)
  },
})
```

Be very careful when using this to avoid infinite loops.

### Bind mounts & `exec`ing in the container

`ava-postgres` uses [testcontainers](https://www.npmjs.com/package/testcontainers) under the hood to manage the Postgres container.

In some scenarios you might want to mount a SQL script into the container and manually load it using `psql`.

You can do this with the `bindMounts` option:

```ts
const getTestPostgresDatabase = getTestPostgresDatabaseFactory({
  container: {
    bindMounts: [
      {
        source: "/path/on/host",
        target: "/test.sql",
      },
    ],
  },
  beforeTemplateIsBaked: async ({
    connection: { username, database },
    containerExec,
  }) => {
    const { exitCode } = await containerExec(
      `psql -U ${username} -d ${database} -f /test.sql`.split(" ")
    )

    if (exitCode !== 0) {
      throw new Error(`Failed to load test file`)
    }
  },
})
```
