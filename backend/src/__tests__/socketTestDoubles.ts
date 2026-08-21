export type Emission = {
  senderId: string;
  scope: string;
  event: string;
  payload: any;
  volatile: boolean;
};

class FakeOperator {
  constructor(
    private emissions: Emission[],
    private senderId: string,
    private scope: string,
    private isVolatile = false,
  ) {}

  get volatile() {
    return new FakeOperator(this.emissions, this.senderId, this.scope, true);
  }

  emit(event: string, payload: any) {
    this.emissions.push({
      senderId: this.senderId,
      scope: this.scope,
      event,
      payload,
      volatile: this.isVolatile,
    });
  }
}

export class FakeSocket {
  readonly handshake = { auth: {}, headers: {} };
  readonly rooms: Set<string>;
  private handlers = new Map<string, (...args: any[]) => any>();

  constructor(
    readonly id: string,
    private emissions: Emission[],
  ) {
    this.rooms = new Set([id]);
  }

  get volatile() {
    return this;
  }

  on(event: string, handler: (...args: any[]) => any) {
    this.handlers.set(event, handler);
  }

  emit(event: string, payload: any) {
    this.emissions.push({ senderId: "server", scope: this.id, event, payload, volatile: false });
  }

  to(scope: string) {
    return new FakeOperator(this.emissions, this.id, scope);
  }

  async join(scope: string) {
    this.rooms.add(scope);
  }

  async leave(scope: string) {
    this.rooms.delete(scope);
  }

  async trigger(event: string, ...args: any[]) {
    return await this.handlers.get(event)?.(...args);
  }
}

export class FakeIo {
  readonly emissions: Emission[] = [];
  private middleware: ((socket: FakeSocket, next: (error?: Error) => void) => any) | null = null;
  private connectionHandler: ((socket: FakeSocket) => void) | null = null;

  use(handler: any) {
    this.middleware = handler;
  }

  on(event: string, handler: any) {
    if (event === "connection") this.connectionHandler = handler;
  }

  to(scope: string) {
    return new FakeOperator(this.emissions, "io", scope);
  }

  async connect(id: string) {
    const socket = new FakeSocket(id, this.emissions);
    await new Promise<void>((resolve, reject) => {
      this.middleware?.(socket, (error?: Error) => (error ? reject(error) : resolve()));
    });
    this.connectionHandler?.(socket);
    return socket;
  }
}

export const room = (drawingId: string) => `drawing_${drawingId}`;
