import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

const express = require("express");

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const bodyLimit = process.env.JSON_BODY_LIMIT ?? "50mb";
  const allowedOrigins = (
    process.env.CORS_ORIGINS ??
    [
      "https://admin.chin-chin.hr",
      "https://api.chin-chin.hr",
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:4000",
    ].join(",")
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.use(express.json({ limit: bodyLimit }));
  app.use(express.urlencoded({ extended: true, limit: bodyLimit }));
  app.enableCors({
    origin(
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS origin is not allowed: ${origin}`), false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });
  app.setGlobalPrefix("api");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = Number(process.env.APP_PORT ?? 4000);
  await app.listen(port);
}

void bootstrap();
