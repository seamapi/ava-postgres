import { SharedWorker } from 'ava/plugin';

declare const workerWrapper: (arg: SharedWorker.FactoryOptions | SharedWorker.Protocol) => Promise<void>;

export { workerWrapper as default };
