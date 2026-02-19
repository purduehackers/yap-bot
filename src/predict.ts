import { and, count, eq, is, sql } from "drizzle-orm";
import { db } from "./db";
import { markov4Table, messagesTable, messagesView } from "./db/schema";
import { tokenize } from "./train";

export class CannotExtrapolate extends Error {
    public prompt: string;

    constructor(prompt: string) {
        super(`cannot extrapolate from prompt "${prompt}"`);
        this.prompt = prompt;
    }
}

export interface CitedMessage {
    token: string;
    guildId: string;
    channelId: string;
    messageId: string;
}
export interface GeneratedSentence {
    sentence: string;
    citedMessages: CitedMessage[];
}
export async function generateSentence(
    prompt: string,
    guildId: string,
    authorId?: string,
    channelId?: string,
): Promise<GeneratedSentence> {
    const tokens = Array.from(tokenize(prompt));
    const citedMessages: CitedMessage[] = [];
    let isFirstToken = true;
    await db.transaction(async (tx) => {
        while (true) {
            const filter = and(
                sql`${markov4Table.word1} IS ${tokens.at(-4) ?? null}`,
                sql`${markov4Table.word2} IS ${tokens.at(-3) ?? null}`,
                sql`${markov4Table.word3} IS ${tokens.at(-2) ?? null}`,
                sql`${markov4Table.word4} IS ${tokens.at(-1) ?? null}`,
                channelId
                    ? eq(messagesView.channelId, channelId)
                    : eq(messagesView.guildId, guildId),
                authorId ? eq(messagesView.userId, authorId) : undefined,
            );
            const countResult = await tx
                .select({ count: count() })
                .from(markov4Table)
                .innerJoin(
                    messagesView,
                    eq(markov4Table.messageId, messagesView.messageId),
                )
                .where(filter);
            const nRows = countResult[0]!.count;
            const offset = Math.floor(Math.random() * nRows);
            const tokenResult = await tx
                .select({
                    word5: markov4Table.word5,
                    messageId: messagesView.messageId,
                    channelId: messagesView.channelId,
                    guildId: messagesView.guildId,
                })
                .from(markov4Table)
                .innerJoin(
                    messagesView,
                    eq(markov4Table.messageId, messagesView.messageId),
                )
                .where(filter)
                .offset(offset)
                .limit(1);
            const token = tokenResult[0]?.word5 ?? null;
            if (token === null) break;
            isFirstToken = false;
            tokens.push(token);
            const citation: CitedMessage | undefined = tokenResult[0]
                ? {
                      token,
                      messageId: tokenResult[0].messageId,
                      guildId: tokenResult[0].guildId,
                      channelId: tokenResult[0].channelId,
                  }
                : undefined;
            if (citation && token.trim() !== "") {
                const lastCitation = citedMessages.at(-1);
                if (
                    lastCitation &&
                    lastCitation.messageId == citation.messageId
                ) {
                    lastCitation.token += " " + citation.token;
                } else {
                    citedMessages.push(citation);
                }
            }
            if (tokens.length > 1000) {
                throw new Error("runaway message");
            }
        }
    });
    if (isFirstToken) {
        throw new CannotExtrapolate(prompt);
    }
    return {
        sentence: tokens.join(""),
        citedMessages,
    };
}
