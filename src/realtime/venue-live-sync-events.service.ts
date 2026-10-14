import { Injectable } from "@nestjs/common";
import { Subject } from "rxjs";

export type VenueLiveSyncTrigger = {
  venueId: string;
  reason: string;
};

@Injectable()
export class VenueLiveSyncEventsService {
  private readonly triggerSubject = new Subject<VenueLiveSyncTrigger>();

  readonly triggers$ = this.triggerSubject.asObservable();

  emit(venueId: string, reason: string) {
    this.triggerSubject.next({ venueId, reason });
  }
}
