import { Router } from "@webtools/expressapi";

import healthRouter from "@/routes/health.ts";
import socketRouter from "@/routes/socket.ts";
import whepRouter from "@/routes/whep.ts";

export default new Router()
	.use(healthRouter)
	.use(socketRouter)
	.use(whepRouter);
