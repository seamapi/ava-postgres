# ava-postgres

`ava-postgres` is a test fixture for [AVA](https://github.com/avajs/ava) that provides you with nearly-instant access to a fresh Postgres database for every test.

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

### Database setup

`ava-postgres` uses [Postgres templates](https://www.postgresql.org/docs/current/manage-ag-templatedbs.html) so you only pay the setup cost once. After a template has been created, Postgres can create a new database from it in milliseconds.

If you want to perform common database setup, you can use a hook and pass parameters to the `getTestDatabase()` function:

```ts
import { getTestPostgresDatabaseFactory } from "ava-postgres"

type GetTestDatabaseParams = {
  shouldMigrate?: boolean
  shouldSeed?: boolean
}

export const getTestDatabase = getTestPostgresDatabaseFactory<GetTestDatabaseParams>({
  hooks: {
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
  }
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
  hooks: {
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
  },
})
```
