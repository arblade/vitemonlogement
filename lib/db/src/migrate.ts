import { openDatabase } from "./index";

const handle = await openDatabase();
await handle.migrate();
await handle.close();
console.log(`Migrations appliquées (${handle.kind}).`);
