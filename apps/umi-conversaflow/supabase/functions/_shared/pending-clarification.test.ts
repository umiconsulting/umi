import { assertEquals } from "jsr:@std/assert";
import {
  getActivePendingClarification,
  isPendingClarificationExpired,
} from "./pending-clarification.ts";

Deno.test("isPendingClarificationExpired returns true when expires_at is in the past", () => {
  const pending = { expires_at: "2026-04-19T10:00:00.000Z" };
  const now = new Date("2026-04-19T10:00:01.000Z");

  assertEquals(isPendingClarificationExpired(pending, now), true);
});

Deno.test("getActivePendingClarification clears expired clarification slots", () => {
  const pending = {
    target: "variant",
    resume_tool: "add_to_cart",
    expires_at: "2026-04-19T10:00:00.000Z",
  };
  const now = new Date("2026-04-19T10:05:00.000Z");

  assertEquals(getActivePendingClarification(pending, now), null);
});

Deno.test("getActivePendingClarification keeps unexpired clarification slots", () => {
  const pending = {
    target: "variant",
    resume_tool: "add_to_cart",
    expires_at: "2026-04-19T10:10:00.000Z",
  };
  const now = new Date("2026-04-19T10:05:00.000Z");

  assertEquals(getActivePendingClarification(pending, now), pending);
});
