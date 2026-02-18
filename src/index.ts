import { Client, GatewayIntentBits } from "discord.js";
import { env } from "@/env";
import { register as registerTracking } from "@/track";
import { register as registerCommands } from "@/commands";

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

    [registerTracking, registerCommands].forEach((f) => f(client));
});

client.login(env.DISCORD_BOT_TOKEN);
