import { EventEmitter } from "node:events";
import type { BrokerState, JobRecord, ResourceRecord } from "./types/index.js";

export type BrokerEvent =
  | { type: "state"; state: BrokerState }
  | { type: "resource"; resource: ResourceRecord }
  | { type: "active-job"; activeJobId: string | null }
  | { type: "job"; job: JobRecord };

export type BrokerEventListener = (event: BrokerEvent) => void;

export class BrokerEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(event: BrokerEvent): void {
    this.emitter.emit("event", structuredClone(event));
  }

  subscribe(listener: BrokerEventListener): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }
}
