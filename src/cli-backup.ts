import { config } from "./config.js";import { backup } from "./backup.js";const c=config();console.log(await backup(c.db,c.db.replace(/\\[^\\]+$/,"")));
