import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ReservationsService } from "./reservations.service";

const CLEANUP_INTERVAL_MS = 60 * 1000;

@Injectable()
export class ReservationCleanupScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ReservationCleanupScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(private readonly reservationsService: ReservationsService) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.run();
    }, CLEANUP_INTERVAL_MS);

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
      const venueCount =
        await this.reservationsService.runScheduledReservationCleanup();
      if (venueCount > 0) {
        this.logger.log(
          `Reservation cleanup processed ${venueCount} venue(s).`,
        );
      }
    } catch (error) {
      this.logger.error(
        "Scheduled reservation cleanup failed.",
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.isRunning = false;
    }
  }
}
