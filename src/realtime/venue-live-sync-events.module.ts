import { Global, Module } from "@nestjs/common";
import { VenueLiveSyncEventsService } from "./venue-live-sync-events.service";

@Global()
@Module({
  providers: [VenueLiveSyncEventsService],
  exports: [VenueLiveSyncEventsService],
})
export class VenueLiveSyncEventsModule {}
