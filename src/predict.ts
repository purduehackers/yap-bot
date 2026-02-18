import { and, count, eq, is, sql } from "drizzle-orm";
import { db } from "./db";
import { markov4Table, messagesTable } from "./db/schema";
import { tokenize } from "./train";

export class CannotExtrapolate extends Error {
    public prompt: string;

    constructor(prompt: string) {
        super(`cannot extrapolate from prompt "${prompt}"`);
        this.prompt = prompt;
    }
}

export async function generateSentence(
    prompt: string,
    guildId: string,
    authorId?: string,
    channelId?: string,
): Promise<string> {
    const tokens = Array.from(tokenize(prompt));
    let isFirstToken = true;
    await db.transaction(async (tx) => {
        while (true) {
            const filter = and(
                sql`${markov4Table.word1} IS ${tokens.at(-4) ?? null}`,
                sql`${markov4Table.word2} IS ${tokens.at(-3) ?? null}`,
                sql`${markov4Table.word3} IS ${tokens.at(-2) ?? null}`,
                sql`${markov4Table.word4} IS ${tokens.at(-1) ?? null}`,
                channelId
                    ? eq(messagesTable.channelId, channelId)
                    : eq(messagesTable.guildId, guildId),
                authorId ? eq(messagesTable.userId, authorId) : undefined,
            );
            const countResult = await tx
                .select({ count: count() })
                .from(markov4Table)
                .innerJoin(
                    messagesTable,
                    eq(markov4Table.messageId, messagesTable.messageId),
                )
                .where(filter);
            const nRows = countResult[0]!.count;
            const offset = Math.floor(Math.random() * nRows);
            const tokenResult = await tx
                .select({ word5: markov4Table.word5 })
                .from(markov4Table)
                .innerJoin(
                    messagesTable,
                    eq(markov4Table.messageId, messagesTable.messageId),
                )
                .where(filter)
                .offset(offset)
                .limit(1);
            const token = tokenResult[0]?.word5 ?? null;
            if (token === null) break;
            isFirstToken = false;
            tokens.push(token);
            if (tokens.length > 1000) {
                throw new Error("runaway message");
            }
        }
    });
    if (isFirstToken) {
        throw new CannotExtrapolate(prompt);
    }
    return tokens.join("");
}
