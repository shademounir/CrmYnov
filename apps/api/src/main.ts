import "reflect-metadata";
import { createApplication } from "./application.js";
import { loadEnvironment } from "./environment.js";

async function bootstrap(): Promise<void> {
  const config = loadEnvironment(process.env);
  const app = await createApplication(config.logLevel);
  await app.listen(config.port, "0.0.0.0");
}

void bootstrap();
