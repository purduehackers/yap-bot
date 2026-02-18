import { type Message } from "discord.js";
import { Tokenizr } from "tokenizr";
import { markov4Table } from "./db/schema";
import { db } from "./db";

enum Tokens {
    Space = "space",
    Punctuation = "punctuation",
    Word = "word",
    Eof = "EOF",
}

export function* tokenize(message: string) {
    const lexer = new Tokenizr();
    lexer.rule(/\p{Separator}+/u, (ctx) => {
        ctx.accept(Tokens.Space);
    });
    lexer.rule(/[\p{Punctuation}\p{Symbol}]/u, (ctx) => {
        ctx.accept(Tokens.Punctuation);
    });
    lexer.rule(/[^\p{Punctuation}\p{Symbol}\p{Separator}]+/u, (ctx) => {
        ctx.accept(Tokens.Word);
    });
    lexer.input(message);
    while (true) {
        const token = lexer.token()!;
        if (token.type === Tokens.Eof) {
            return token.text;
        } else {
            yield token.text;
        }
    }
}

export async function addMessageToMarkov4(message: Message) {
    if (message.author.bot || message.content.trim().length === 0) {
        return;
    }
    const prefix: (string | null)[] = [null, null, null, null];
    const rows: (typeof markov4Table.$inferInsert)[] = [];
    for (const token of tokenize(message.content)) {
        rows.push({
            messageId: message.id,
            word1: prefix[0],
            word2: prefix[1],
            word3: prefix[2],
            word4: prefix[3],
            word5: token,
        });
        prefix.shift();
        prefix.push(token);
    }
    rows.push({
        messageId: message.id,
        word1: prefix[0],
        word2: prefix[1],
        word3: prefix[2],
        word4: prefix[3],
        word5: null,
    });
    await db.insert(markov4Table).values(rows);
}
