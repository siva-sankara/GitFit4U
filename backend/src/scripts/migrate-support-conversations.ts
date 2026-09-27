import "dotenv/config";
import { connectDatabase, disconnectDatabase } from "../config/db.js";
import { SupportTicket } from "../models/Engagement.js";
import { Conversation, Message } from "../models/Collaboration.js";
import { ensureSupportConversation } from "../services/supportConversationService.js";

// Additive and restartable. Existing tickets and their messages are never removed.
try {
  await connectDatabase();
  await Conversation.createIndexes();
  await Message.createIndexes();
  let cursor: unknown,
    migrated = 0;
  while (true) {
    const tickets = await SupportTicket.find(
      cursor ? { _id: { $gt: cursor } } : {},
    )
      .sort({ _id: 1 })
      .limit(50);
    if (!tickets.length) break;
    for (const ticket of tickets) {
      await ensureSupportConversation(ticket);
      migrated++;
    }
    cursor = tickets[tickets.length - 1]._id;
  }
  console.log(
    `Support conversations migrated: ${migrated}. Historical tickets preserved.`,
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Support migration failed.",
  );
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
