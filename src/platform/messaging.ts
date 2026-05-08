export type MessageHandler<T = unknown> = (msg: T) => Promise<void> | void;

export class MessageRouter {
  private readonly handlers = new Map<string, MessageHandler<any>>();

  on<T extends { type: string }>(type: T['type'], handler: MessageHandler<T>): void {
    this.handlers.set(type, handler);
  }

  async dispatch(msg: unknown): Promise<void> {
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return;
    const { type } = msg as { type: string };
    const handler = this.handlers.get(type);
    if (handler) {
      await handler(msg);
    }
  }
}
