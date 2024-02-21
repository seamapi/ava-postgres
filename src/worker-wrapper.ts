import { SharedWorker } from "ava/plugin"
import { Worker } from "./worker"

const needsToNegotiateProtocol = (
  arg: SharedWorker.FactoryOptions | SharedWorker.Protocol
): arg is SharedWorker.FactoryOptions => {
  return (
    typeof (arg as SharedWorker.FactoryOptions).negotiateProtocol === "function"
  )
}

const workerWrapper = async (
  arg: SharedWorker.FactoryOptions | SharedWorker.Protocol
) => {
  const protocol = needsToNegotiateProtocol(arg)
    ? arg.negotiateProtocol(["ava-4"]).ready()
    : arg

  const { initialData } = protocol

  console.log("creating worker with initialData", initialData)
  const worker = new Worker(initialData as any)

  for await (const testWorker of protocol.testWorkers()) {
    void worker.handleTestWorker(testWorker)
  }
}

export default workerWrapper
