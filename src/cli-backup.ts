import { config } from "./config.js";
import { backup } from "./backup.js";
import { dirname } from "node:path";
const c=config();
console.log(JSON.stringify(await backup(c.db,dirname(c.db)),null,2));
