import { Injectable } from "@nestjs/common";

export type OperationalEventLevel = "info" | "warning" | "error";

export type OperationalEvent = {
  id: string;
  level: OperationalEventLevel;
  source: string;
  message: string;
  createdAt: string;
  details?: Record<string, string | number | boolean | null>;
};

@Injectable()
export class MonitoringService {
  private readonly events: OperationalEvent[] = [];
  private readonly maxEvents = 50;

  record(event: Omit<OperationalEvent, "id" | "createdAt">) {
    const nextEvent: OperationalEvent = {
      ...event,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
    };

    this.events.unshift(nextEvent);
    if (this.events.length > this.maxEvents) {
      this.events.length = this.maxEvents;
    }
  }

  recentEvents() {
    return [...this.events];
  }
}
