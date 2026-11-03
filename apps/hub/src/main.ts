import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { appModule } from "./app.module";
import { loadEnv } from "./common/env";

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create(appModule(env), { rawBody: true });
  await app.listen(env.PORT);
  console.log(`hub listening on :${env.PORT}`);
}
bootstrap();
