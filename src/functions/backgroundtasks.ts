import { logger } from "../logger/logger";

export class BackgroundTasks {
  static async add(task: () => Promise<void>): Promise<void> {
    try {
      await task();
    } catch (err: any) {
      logger.error("Background task failed:", err.message);
    }
  }
}
