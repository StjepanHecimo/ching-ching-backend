import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { MonitoringService } from "./monitoring.service";

type RequestLike = {
  method?: string;
  url?: string;
  originalUrl?: string;
};

type ResponseLike = {
  headersSent?: boolean;
  status: (statusCode: number) => ResponseLike;
  json: (body: unknown) => unknown;
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(private readonly monitoringService: MonitoringService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestLike>();
    const response = context.getResponse<ResponseLike>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const message = this.getMessage(exception);

    this.monitoringService.record({
      level: status >= 500 ? "error" : "warning",
      source: "api",
      message,
      details: {
        method: request.method ?? null,
        path: request.originalUrl ?? request.url ?? null,
        status,
      },
    });

    if (response.headersSent) {
      return;
    }

    response.status(status).json({
      statusCode: status,
      message,
      error:
        exception instanceof HttpException
          ? exception.name
          : "Internal server error",
    });
  }

  private getMessage(exception: unknown) {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (typeof response === "string") {
        return response;
      }

      if (response && typeof response === "object" && "message" in response) {
        const message = (response as { message?: unknown }).message;
        return Array.isArray(message)
          ? message.join(", ")
          : typeof message === "string"
            ? message
            : exception.message;
      }

      return exception.message;
    }

    return exception instanceof Error
      ? exception.message
      : "Neočekivana API greška.";
  }
}
