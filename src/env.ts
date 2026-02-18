import z from "zod";

const schema = z.object({
    DISCORD_BOT_TOKEN: z.string(),
    NICKNAME: z.string().default("Yap Hacker"),
});

export const env = schema.parse(Bun.env);
