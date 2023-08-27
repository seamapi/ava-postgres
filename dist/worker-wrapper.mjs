// src/worker.ts
import pg from "pg";
import { GenericContainer, Network } from "testcontainers";
import { Mutex } from "async-mutex";
import hash from "object-hash";

// src/lib/get-random-database-name.ts
import { customAlphabet } from "nanoid";
var nanoid = customAlphabet("1234567890abcdef", 10);
var getRandomDatabaseName = () => `test_${nanoid()}`;
var get_random_database_name_default = getRandomDatabaseName;

// src/worker.ts
import { parentPort } from "worker_threads";
var Worker = class {
  constructor(initialData) {
    this.initialData = initialData;
    this.paramsHashToTemplateCreationPromise = /* @__PURE__ */ new Map();
    this.keyToDatabaseName = /* @__PURE__ */ new Map();
    this.keyToCreationMutex = /* @__PURE__ */ new Map();
    this.getOrCreateKeyToCreationMutex = new Mutex();
    this.createdDatabasesByTestWorkerId = /* @__PURE__ */ new Map();
    this.getOrCreateTemplateNameMutex = new Mutex();
    this.startContainerPromise = this.startContainer();
  }
  async handleTestWorker(testWorker) {
    testWorker.teardown(async () => {
      await this.handleTestWorkerTeardown(testWorker);
    });
    for await (const message of testWorker.subscribe()) {
      await this.handleMessage(message);
    }
  }
  async handleMessage(message) {
    if (message.data.type === "GET_TEST_DATABASE") {
      const paramsHash = hash(message.data.params ?? null);
      let neededToCreateTemplate = false;
      await this.getOrCreateTemplateNameMutex.runExclusive(() => {
        if (!this.paramsHashToTemplateCreationPromise.has(paramsHash)) {
          neededToCreateTemplate = true;
          this.paramsHashToTemplateCreationPromise.set(
            paramsHash,
            this.createTemplate(message)
          );
        }
      });
      const {
        templateName,
        beforeTemplateIsBakedResult,
        lastMessage: lastMessageFromTemplateCreation
      } = await this.paramsHashToTemplateCreationPromise.get(paramsHash);
      const { postgresClient } = await this.startContainerPromise;
      const fullDatabaseKey = `${paramsHash}-${message.data.key}`;
      let databaseName = message.data.key ? this.keyToDatabaseName.get(fullDatabaseKey) : void 0;
      if (!databaseName) {
        const createDatabase = async () => {
          databaseName = get_random_database_name_default();
          await postgresClient.query(
            `CREATE DATABASE ${databaseName} WITH TEMPLATE ${templateName};`
          );
          this.createdDatabasesByTestWorkerId.set(
            message.testWorker.id,
            (this.createdDatabasesByTestWorkerId.get(message.testWorker.id) ?? []).concat(databaseName)
          );
        };
        if (message.data.key) {
          await this.getOrCreateKeyToCreationMutex.runExclusive(() => {
            if (!this.keyToCreationMutex.has(fullDatabaseKey)) {
              this.keyToCreationMutex.set(fullDatabaseKey, new Mutex());
            }
          });
          const mutex = this.keyToCreationMutex.get(fullDatabaseKey);
          await mutex.runExclusive(async () => {
            if (!this.keyToDatabaseName.has(fullDatabaseKey)) {
              await createDatabase();
              this.keyToDatabaseName.set(fullDatabaseKey, databaseName);
            }
            databaseName = this.keyToDatabaseName.get(fullDatabaseKey);
          });
        } else {
          await createDatabase();
        }
      }
      const gotDatabaseMessage = {
        type: "GOT_DATABASE",
        connectionDetails: await this.getConnectionDetails(databaseName),
        beforeTemplateIsBakedResult
      };
      if (neededToCreateTemplate) {
        lastMessageFromTemplateCreation.value.reply(gotDatabaseMessage);
      } else {
        message.reply(gotDatabaseMessage);
      }
      return;
    }
    throw new Error(`Unknown message: ${JSON.stringify(message.data)}`);
  }
  async handleTestWorkerTeardown(testWorker) {
    const databases = this.createdDatabasesByTestWorkerId.get(testWorker.id);
    if (databases) {
      const { postgresClient } = await this.startContainerPromise;
      const databasesAssociatedWithKeys = new Set(
        this.keyToDatabaseName.values()
      );
      await Promise.all(
        databases.filter((d) => !databasesAssociatedWithKeys.has(d)).map(async (database) => {
          await this.forceDisconnectClientsFrom(database);
          await postgresClient.query(`DROP DATABASE ${database}`);
        })
      );
    }
  }
  async createTemplate(message) {
    const databaseName = get_random_database_name_default();
    const { postgresClient, container } = await this.startContainerPromise;
    await postgresClient.query(`CREATE DATABASE ${databaseName};`);
    const msg = message.reply({
      type: "RUN_HOOK_BEFORE_TEMPLATE_IS_BAKED",
      connectionDetails: await this.getConnectionDetails(databaseName)
    });
    let reply = await msg.replies().next();
    while (reply.value.data.type !== "FINISHED_RUNNING_HOOK_BEFORE_TEMPLATE_IS_BAKED") {
      const replyValue = reply.value.data;
      if (replyValue.type === "EXEC_COMMAND_IN_CONTAINER") {
        const result = await container.exec(replyValue.command);
        const message2 = reply.value.reply({
          type: "EXEC_COMMAND_IN_CONTAINER_RESULT",
          result
        });
        reply = await message2.replies().next();
      }
    }
    await this.forceDisconnectClientsFrom(databaseName);
    await postgresClient.query(
      `ALTER DATABASE ${databaseName} WITH is_template TRUE;`
    );
    return {
      templateName: databaseName,
      beforeTemplateIsBakedResult: reply.value.data.result,
      lastMessage: reply
    };
  }
  async forceDisconnectClientsFrom(databaseName) {
    const { postgresClient } = await this.startContainerPromise;
    await postgresClient.query(
      `REVOKE CONNECT ON DATABASE ${databaseName} FROM public`
    );
    await postgresClient.query(`
      SELECT pid, pg_cancel_backend(pid)
      FROM pg_stat_activity
      WHERE datname = '${databaseName}' AND pid <> pg_backend_pid();
      `);
    await postgresClient.query(`
      SELECT pid, pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = '${databaseName}' AND pid <> pg_backend_pid();
      `);
  }
  async getConnectionDetails(databaseName) {
    const { container, network } = await this.startContainerPromise;
    const externalDatabaseUrl = `postgresql://postgres:@${container.getHost()}:${container.getMappedPort(
      5432
    )}/${databaseName}`;
    return {
      connectionString: externalDatabaseUrl,
      connectionStringDocker: `postgresql://postgres:@${container.getName().replace("/", "")}:5432/${databaseName}`,
      networkDocker: {
        id: network.getId(),
        options: network["options"]
      },
      host: container.getHost(),
      port: container.getMappedPort(5432),
      database: databaseName,
      username: "postgres",
      password: ""
    };
  }
  async startContainer() {
    var _a;
    parentPort.postMessage({
      type: "ava-postgres",
      message: "starting container...",
      postgresVersion: this.initialData.postgresVersion
    });
    const network = await new Network().start();
    parentPort.postMessage({
      type: "ava-postgres",
      message: "stared network"
    });
    let container = new GenericContainer(
      `postgres:${this.initialData.postgresVersion}`
    ).withExposedPorts(5432).withName(get_random_database_name_default()).withEnvironment({
      POSTGRES_HOST_AUTH_METHOD: "trust",
      PGDATA: "/var/lib/postgresql/data"
    }).withCommand([
      "-c",
      "max_connections=1000",
      "-c",
      "fsync=off",
      "-c",
      "synchronous_commit=off",
      "-c",
      "full_page_writes=off"
    ]).withTmpFs({ "/var/lib/postgresql/data": "rw" }).withNetwork(network).withStartupTimeout(12e4).withBindMounts(((_a = this.initialData.containerOptions) == null ? void 0 : _a.bindMounts) ?? []);
    parentPort.postMessage({
      type: "ava-postgres",
      message: "starting generic container instance..."
    });
    const startedContainer = await container.start();
    const connectionString = `postgresql://postgres:@${startedContainer.getHost()}:${startedContainer.getMappedPort(
      5432
    )}/postgres`;
    parentPort.postMessage({
      type: "ava-postgres",
      message: "container started",
      port: startedContainer.getMappedPort(5432),
      host: startedContainer.getHost(),
      connectionString
    });
    const { exitCode, output } = await startedContainer.exec(["pg_isready"]);
    if (exitCode !== 0) {
      parentPort.postMessage({
        type: "ava-postgres",
        message: "Postgres Container failed to start",
        output,
        exitCode
      });
      throw new Error(
        `pg_isready exited with code ${exitCode} (database container didn't finish starting)`
      );
    }
    parentPort.postMessage({
      type: "ava-postgres",
      message: "pg_isready succeeded",
      exitCode,
      output
    });
    const postgresClient = new pg.Pool({
      connectionString
    });
    postgresClient.on("error", (err) => {
      parentPort.postMessage({
        type: "ava-postgres",
        message: "postgres client error",
        errMessage: err.message,
        stack: err.stack
      });
    });
    const heartbeat = async () => {
      try {
        const { rows } = await postgresClient.query("SELECT 1");
        parentPort.postMessage({
          type: "ava-postgres",
          message: "postgres heartbeat success",
          rows
        });
      } catch (err) {
        parentPort.postMessage({
          type: "ava-postgres",
          message: "postgres heartbeat failure",
          errMessage: err.message,
          stack: err.stack
        });
      }
      setTimeout(heartbeat, 5e3);
    };
    heartbeat();
    return {
      container: startedContainer,
      network,
      postgresClient
    };
  }
};

// src/worker-wrapper.ts
var needsToNegotiateProtocol = (arg) => {
  return typeof arg.negotiateProtocol === "function";
};
var workerWrapper = async (arg) => {
  const protocol = needsToNegotiateProtocol(arg) ? arg.negotiateProtocol(["ava-4"]).ready() : arg;
  const { initialData } = protocol;
  const worker = new Worker(initialData);
  for await (const testWorker of protocol.testWorkers()) {
    void worker.handleTestWorker(testWorker);
  }
};
var worker_wrapper_default = workerWrapper;
export {
  worker_wrapper_default as default
};
//# sourceMappingURL=worker-wrapper.mjs.map