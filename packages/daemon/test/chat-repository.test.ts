import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { createDb } from "../src/db/connection.js";
import { migrate } from "../src/db/migrate.js";
import { coreSchema } from "../src/db/migrations/001_core_schema.js";
import { bindingsSessionsSchema } from "../src/db/migrations/002_bindings_sessions.js";
import { eventsSchema } from "../src/db/migrations/003_events.js";
import { chatMessagesSchema } from "../src/db/migrations/016_chat_messages.js";
import { RigRepository } from "../src/domain/rig-repository.js";
import { ChatRepository } from "../src/domain/chat-repository.js";

describe("ChatRepository", () => {
  let db: Database.Database;
  let rigRepo: RigRepository;
  let chatRepo: ChatRepository;
  let rigId: string;

  beforeEach(() => {
    db = createDb();
    migrate(db, [coreSchema, bindingsSessionsSchema, eventsSchema, chatMessagesSchema]);
    rigRepo = new RigRepository(db);
    chatRepo = new ChatRepository(db);
    const rig = rigRepo.createRig("test-rig");
    rigId = rig.id;
  });

  afterEach(() => {
    db.close();
  });

  it("send persists with ULID", () => {
    const msg = chatRepo.send(rigId, "alice", "hello world");
    expect(msg.id).toBeTruthy();
    expect(msg.id.length).toBe(26); // ULID is 26 chars
    expect(msg.rigId).toBe(rigId);
    expect(msg.sender).toBe("alice");
    expect(msg.body).toBe("hello world");
    expect(msg.kind).toBe("message");
    expect(msg.createdAt).toBeTruthy();
  });

  it("history returns chronological order", () => {
    chatRepo.send(rigId, "alice", "first");
    chatRepo.send(rigId, "bob", "second");
    chatRepo.send(rigId, "alice", "third");

    const messages = chatRepo.history(rigId);
    expect(messages).toHaveLength(3);
    expect(messages[0]!.body).toBe("first");
    expect(messages[1]!.body).toBe("second");
    expect(messages[2]!.body).toBe("third");
  });

  it("history --topic returns messages between topic marker and next topic marker", () => {
    chatRepo.send(rigId, "alice", "before topic");
    chatRepo.sendTopic(rigId, "alice", "deploy", "starting deploy");
    chatRepo.send(rigId, "bob", "deploy message");
    chatRepo.send(rigId, "alice", "another deploy msg");
    chatRepo.sendTopic(rigId, "bob", "standup", "daily standup");
    chatRepo.send(rigId, "bob", "standup message — should NOT appear");

    const messages = chatRepo.history(rigId, { topic: "deploy" });
    const bodies = messages.map((m) => m.body);
    // Should include the deploy topic marker and messages within that topic
    expect(bodies).toContain("starting deploy");
    expect(bodies).toContain("deploy message");
    expect(bodies).toContain("another deploy msg");
    // Should NOT include messages from the next topic
    expect(bodies).not.toContain("daily standup");
    expect(bodies).not.toContain("standup message — should NOT appear");
  });

  it("sendTopic creates topic-kind message", () => {
    const msg = chatRepo.sendTopic(rigId, "alice", "standup", "daily standup");
    expect(msg.kind).toBe("topic");
    expect(msg.topic).toBe("standup");
    expect(msg.body).toBe("daily standup");
    expect(msg.sender).toBe("alice");
  });
});
