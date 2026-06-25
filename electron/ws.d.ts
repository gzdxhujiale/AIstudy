declare module "ws" {
  import { EventEmitter } from "node:events";

  type RawData = string | Buffer | ArrayBuffer | Buffer[];

  export default class WebSocket extends EventEmitter {
    constructor(address: string);
    send(data: string): void;
    close(): void;
    on(event: "open", listener: () => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    on(event: "message", listener: (data: RawData) => void): this;
  }
}
