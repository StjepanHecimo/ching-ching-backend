import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { VenueChinChinPanelService } from "./venue-chin-chin-panel.service";

const EVENT_NOTIFICATION_INTERVAL_MS = 5 * 60 * 1000;

@Injectable()
export class VenueEventNotificationScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(VenueEventNotificationScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private readonly venueChinChinPanelService: VenueChinChinPanelService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.run();
    }, EVENT_NOTIFICATION_INTERVAL_MS);

    void this.run();
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async run() {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    try {
      const processed =
        await this.venueChinChinPanelService.runScheduledEventNotifications();
      if (processed > 0) {
        this.logger.log(`Processed ${processed} event notification(s).`);
      }
    } catch (error) {
      this.logger.error(
        "Scheduled event notifications failed.",
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.isRunning = false;
    }
  }
}
