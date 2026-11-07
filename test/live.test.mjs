import assert from "node:assert/strict";
import test from "node:test";

const storage = new Map();
globalThis.host = {
  storage: {
    get: (key) => storage.get(key) ?? null,
    set: (key, value) => storage.set(key, value),
    remove: (key) => storage.delete(key),
  },
  crypto: { md5: () => "" },
  t: (text) => text,
  signInPrompt: () => {},
};

const plugin = await import("../index.js");

test("anonymous home, lyrics and a real stream URL", { timeout: 60_000 }, async () => {
  const page = await plugin.home();
  assert.ok(page.sections.length > 0, "home returned no sections");
  const tracks = page.sections.find((section) => section.tracks?.length)?.tracks;
  assert.ok(tracks?.length, "home returned no tracks");
  assert.match(tracks[0].id, /^[0-9A-Za-z]+$/);

  const found = await plugin.search({ query: "晴天", kind: "tracks", offset: 0 });
  assert.equal(found.tracks[0].name, "晴天");
  const artists = await plugin.search({ query: "周杰伦", kind: "artists", offset: 0 });
  assert.ok(artists.artists[0]?.name);

  const modes = await plugin.stations();
  assert.ok(modes.some((mode) => mode.id === "radio:99"));
  try {
    const next = await plugin.stationNext({ id: "radio:99" });
    assert.ok(Array.isArray(next));
  } catch (error) {
    assert.equal(error.code, "signIn");
  }

  const audio = await plugin.stream({ id: tracks[0].id });
  assert.match(audio.url, /^https:\/\//);
  assert.ok(["m4a", "mp3", "aac", "flac"].includes(audio.type), audio.type);
  const words = await plugin.lyrics({ id: tracks[0].id });
  assert.ok(words.lines?.length || words.lrc, "lyrics were empty");

  const probe = await fetch(audio.url, {
    method: "GET",
    headers: { ...audio.headers, range: "bytes=0-1" },
  });
  assert.ok(probe.status === 200 || probe.status === 206, `audio HTTP ${probe.status}`);
  await probe.body?.cancel();
});
