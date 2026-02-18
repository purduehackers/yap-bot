import { drizzle } from 'drizzle-orm/bun-sqlite';
import { env } from "@/env";

const db = drizzle(env.DB_FILENAME);
