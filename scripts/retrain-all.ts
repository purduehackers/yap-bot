import { db } from "@/db";
import { markov4Table, messagesTable, usersTable } from "@/db/schema";
import { addMessageToMarkov4 } from "@/train";
import { Message } from "discord.js";
import { eq, and, isNull, not, sql, gt } from "drizzle-orm";

async function* getMessagesPaginated(pageSize: number) {
    for (let i = 0; true; i++) {
        const messages = await db
            .select({
                messageId: messagesTable.messageId,
                content: messagesTable.content,
                userIsBot: usersTable.isBot,
            })
            .from(messagesTable)
            .innerJoin(usersTable, eq(usersTable.userId, messagesTable.userId))
            .leftJoin(
                markov4Table,
                eq(markov4Table.messageId, messagesTable.messageId),
            )
            .where(
                and(
                    isNull(markov4Table.messageId),
                    not(usersTable.isBot),
                    gt(sql`length(${messagesTable.content})`, 0),
                ),
            )
            .offset(i * pageSize)
            .limit(pageSize);
        if (messages.length === 0) break;
        yield messages;
    }
}

(async () => {
    let count = 0;
    for await (const messages of getMessagesPaginated(1000)) {
        await db.transaction(async (tx) => {
            for (const message of messages) {
                await addMessageToMarkov4(
                    {
                        id: message.messageId,
                        content: message.content,
                        author: { bot: message.userIsBot },
                    } as unknown as Message,
                    tx,
                );
            }
            count += messages.length;
            console.log(`Processed ${count} messages`);
        });
    }
    console.log(`Processed ${count} messages total`);
})();
