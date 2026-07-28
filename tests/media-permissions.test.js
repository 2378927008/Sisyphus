import test from "node:test";
import assert from "node:assert/strict";
import {
  configureMediaPermissions,
  shouldGrantMediaPermission
} from "../src/main/media-permissions.js";

test("shouldGrantMediaPermission grants only the approved main renderer page", () => {
  const approvedUrl = "file:///C:/app/src/renderer/index.html";
  const webContents = { getURL: () => approvedUrl };

  assert.equal(
    shouldGrantMediaPermission({
      permission: "media",
      requestingUrl: approvedUrl,
      webContents,
      allowedWebContents: webContents,
      allowedUrl: approvedUrl,
      isMainFrame: true
    }),
    true
  );
});

test("shouldGrantMediaPermission denies other webContents, frames, local files, and remote requests", () => {
  const approvedUrl = "file:///C:/app/src/renderer/index.html";
  const webContents = { getURL: () => approvedUrl };
  const base = {
    permission: "media",
    requestingUrl: approvedUrl,
    webContents,
    allowedWebContents: webContents,
    allowedUrl: approvedUrl,
    isMainFrame: true
  };

  assert.equal(
    shouldGrantMediaPermission({
      ...base,
      permission: "notifications"
    }),
    false
  );
  assert.equal(
    shouldGrantMediaPermission({
      ...base,
      requestingUrl: "https://example.com"
    }),
    false
  );
  assert.equal(
    shouldGrantMediaPermission({
      ...base,
      requestingUrl: "file:///C:/app/src/renderer/other.html"
    }),
    false
  );
  assert.equal(
    shouldGrantMediaPermission({
      ...base,
      webContents: {}
    }),
    false
  );
  assert.equal(
    shouldGrantMediaPermission({
      ...base,
      isMainFrame: false
    }),
    false
  );
});

test("configureMediaPermissions wires request and check handlers", () => {
  const handlers = {};
  const approvedUrl = "file:///C:/app/src/renderer/index.html";
  const webContents = { getURL: () => approvedUrl };
  const session = {
    setPermissionRequestHandler(handler) {
      handlers.request = handler;
    },
    setPermissionCheckHandler(handler) {
      handlers.check = handler;
    }
  };

  configureMediaPermissions(session, {
    getAllowedWebContents: () => webContents,
    getAllowedUrl: () => approvedUrl
  });

  let requestDecision;
  handlers.request(
    webContents,
    "media",
    (decision) => {
      requestDecision = decision;
    },
    {
      requestingUrl: approvedUrl,
      isMainFrame: true
    }
  );

  assert.equal(requestDecision, true);
  assert.equal(handlers.check(
    webContents,
    "media",
    approvedUrl,
    { isMainFrame: true }
  ), true);
  assert.equal(handlers.check(
    {},
    "media",
    approvedUrl,
    { isMainFrame: true }
  ), false);
  assert.equal(handlers.check(
    webContents,
    "media",
    "file:///C:/app/src/renderer/other.html",
    { isMainFrame: true }
  ), false);
});
