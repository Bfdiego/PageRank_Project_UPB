import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeUrl, normalizeUrlInput } from "./url.js";

test("normalizes user input by adding https when the scheme is missing", () => {
  assert.equal(normalizeUrlInput("example.com"), "https://example.com");
});

test("canonicalizes the root URL the same way as the backend", () => {
  assert.equal(canonicalizeUrl("https://example.com", true), "https://example.com/");
});

test("canonicalizes host, ports, trailing slashes, fragments and query params", () => {
  assert.equal(
    canonicalizeUrl("HTTPS://Example.COM:443/docs/?x=1#section", true),
    "https://example.com/docs"
  );
  assert.equal(
    canonicalizeUrl("HTTPS://Example.COM:443/docs/?x=1#section", false),
    "https://example.com/docs?x=1"
  );
});
