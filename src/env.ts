import z from "zod";

const schema = z.object({
    DISCORD_BOT_TOKEN: z.string(),
    NICKNAME: z.string().default("Yap Hacker"),
    DB_FILENAME: z.string(),
});

export const env = schema.parse(process.env);
