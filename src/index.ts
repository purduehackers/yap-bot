import { Client, GatewayIntentBits } from "discord.js";
import { env } from "@/env";

const client = new Client({
    intents: [
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.Guilds,
        GatewayIntentBits.MessageContent,
    ],
});

client.once("clientReady", async (client) => {
    await client.user.setUsername(env.NICKNAME);
    console.log(`Logged in as ${client.user.displayName}`);
    client.destroy();
});

client.login(env.DISCORD_BOT_TOKEN);
