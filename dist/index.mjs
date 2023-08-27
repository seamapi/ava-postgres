// src/index.ts
import { registerSharedWorker } from "ava/plugin";
import hash from "object-hash";
import path from "path";
import { Pool } from "pg";
import { StartedNetwork } from "testcontainers";
var mapWorkerConnectionDetailsToConnectionDetails = (connectionDetailsFromWorker) => ({
  ...connectionDetailsFromWorker,
  networkDocker: new StartedNetwork(
    connectionDetailsFromWorker.networkDocker.id,
    connectionDetailsFromWorker.networkDocker.options
  ),
  pool: new Pool({
    connectionString: connectionDetailsFromWorker.connectionString
  })
});
var getWorker = async (initialData, options) => {
  const key = hash({
    initialData,
    key: options == null ? void 0 : options.key
  });
  if (process.env.IS_TESTING_AVA_POSTGRES) {
    const { registerSharedTypeScriptWorker } = await import("ava-typescript-worker");
    return registerSharedTypeScriptWorker({
      filename: new URL(
        `file:${path.resolve(__dirname, "worker-wrapper.ts")}#${key}`
      ),
      initialData
    });
  }
  return registerSharedWorker({
    filename: new URL(
      `file:${path.resolve(__dirname, "worker-wrapper.mjs")}#${key}`
    ),
    initialData,
    supportedProtocols: ["ava-4"]
  });
};
var getTestPostgresDatabaseFactory = (options) => {
  const initialData = {
    postgresVersion: (options == null ? void 0 : options.postgresVersion) ?? "14",
    containerOptions: options == null ? void 0 : options.container
  };
  const workerPromise = getWorker(initialData, options);
  const getTestPostgresDatabase = async (params, getTestDatabaseOptions) => {
    const worker = await workerPromise;
    await worker.available;
    const waitForAndHandleReply = async (message) => {
      let reply = await message.replies().next();
      const replyData = reply.value.data;
      if (replyData.type === "RUN_HOOK_BEFORE_TEMPLATE_IS_BAKED") {
        let result = {
          status: "success",
          result: void 0
        };
        if (options == null ? void 0 : options.beforeTemplateIsBaked) {
          const connectionDetails = mapWorkerConnectionDetailsToConnectionDetails(
            replyData.connectionDetails
          );
          connectionDetails.pool.on("error", (error) => {
            if (error.message.includes(
              "terminating connection due to administrator command"
            )) {
              return;
            }
            throw error;
          });
          try {
            const hookResult = await options.beforeTemplateIsBaked({
              params,
              connection: connectionDetails,
              containerExec: async (command) => {
                const request = reply.value.reply({
                  type: "EXEC_COMMAND_IN_CONTAINER",
                  command
                });
                reply = await request.replies().next();
                if (reply.value.data.type !== "EXEC_COMMAND_IN_CONTAINER_RESULT") {
                  throw new Error(
                    "Expected EXEC_COMMAND_IN_CONTAINER_RESULT message"
                  );
                }
                return reply.value.data.result;
              }
            });
            result = {
              status: "success",
              result: hookResult
            };
          } catch (error) {
            result = {
              status: "error",
              error: error instanceof Error ? error.stack ?? error.message : new Error(
                "Unknown error type thrown in beforeTemplateIsBaked hook"
              )
            };
          } finally {
            await connectionDetails.pool.end();
          }
        }
        return waitForAndHandleReply(
          reply.value.reply({
            type: "FINISHED_RUNNING_HOOK_BEFORE_TEMPLATE_IS_BAKED",
            result
          })
        );
      } else if (replyData.type === "GOT_DATABASE") {
        if (replyData.beforeTemplateIsBakedResult.status === "error") {
          if (typeof replyData.beforeTemplateIsBakedResult.error === "string") {
            throw new Error(replyData.beforeTemplateIsBakedResult.error);
          }
          throw replyData.beforeTemplateIsBakedResult.error;
        }
        return {
          ...mapWorkerConnectionDetailsToConnectionDetails(
            replyData.connectionDetails
          ),
          beforeTemplateIsBakedResult: replyData.beforeTemplateIsBakedResult.result
        };
      }
      throw new Error(`Unexpected message type: ${replyData.type}`);
    };
    return waitForAndHandleReply(
      worker.publish({
        type: "GET_TEST_DATABASE",
        params,
        key: getTestDatabaseOptions == null ? void 0 : getTestDatabaseOptions.key
      })
    );
  };
  return getTestPostgresDatabase;
};
export {
  getTestPostgresDatabaseFactory
};
//# sourceMappingURL=index.mjs.map