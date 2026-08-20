import { HttpServer } from "@webtools/expressapi";
import { startPico } from "@/services/pico.ts";
import mainRouter from "@/routes/index.ts";
import { config } from "@/config.ts";

await startPico();

const httpServer = new HttpServer()
	.use(mainRouter);

export type AppRouter = typeof httpServer;
httpServer.listen(config.nodePort);
