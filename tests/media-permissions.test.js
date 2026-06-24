import test from "node:test";
import assert from "node:assert/strict";
import {
  configureMediaPermissions,
  shouldGrantMediaPermission
} from "../src/main/media-permissions.js";

test("shouldGrantMediaPermission grants media requests for local app pages", () => {
  assert.equal(
    shouldGrantMediaPermission({
      permission: "media",
      requestingUrl: "file:///C:/app/src/renderer/index.html"
    }),
    true
  );
});

test("shouldGrantMediaPermission denies non-media and remote requests", () => {
  assert.equal(
    shouldGrantMediaPermission({
      permission: "notifications",
      requestingUrl: "file:///C:/app/src/renderer/index.html"
    }),
    false
  );
  assert.equal(
    shouldGrantMediaPermission({
      permission: "media",
      requestingUrl: "https://example.com"
    }),
    false
  );
});

test("configureMediaPermissions wires request and check handlers", () => {
  const handlers = {};
  const session = {
    setPermissionRequestHandler(handler) {
      handlers.request = handler;
    },
    setPermissionCheckHandler(handler) {
      handlers.check = handler;
    }
  };

  configureMediaPermissions(session);

  let requestDecision;
  handlers.request(
    { getURL: () => "file:///C:/app/src/renderer/index.html" },
    "media",
    (decision) => {
      requestDecision = decision;
    }
  );

  assert.equal(requestDecision, true);
  assert.equal(handlers.check(null, "media", "file:///C:/app/src/renderer/index.html"), true);
  assert.equal(handlers.check(null, "media", "https://example.com"), false);
});
