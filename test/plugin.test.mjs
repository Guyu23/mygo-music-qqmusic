import assert from "node:assert/strict";
import test from "node:test";

const storage = new Map();
const prompts = [];
const writes = [];

globalThis.host = {
  storage: {
    get: (key) => storage.get(key) ?? null,
    set: (key, value) => storage.set(key, value),
    remove: (key) => storage.delete(key),
  },
  crypto: { md5: () => "" },
  t: (text) => text,
  signInPrompt: (prompt) => prompts.push(prompt),
};

const plugin = await import("../index.js");

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, { status, headers: { "content-type": "application/json", ...headers } });
}

function callOf(body) {
  const json = JSON.parse(body);
  for (const value of Object.values(json)) {
    if (value && typeof value === "object" && value.module && value.method) return value;
  }
  return null;
}

globalThis.fetch = async (input, init = {}) => {
  const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
  const path = url.pathname;
  if (path === "/ptqrshow") {
    return jsonResponse(
      'ptui_qrcode_CB({"em":"","qrcode":"http://txz.qq.com/p?k=scan-token&f=716027609","ec":0})',
      { headers: { "set-cookie": "qrsig=sig-1; Path=/; Domain=.qq.com" } },
    );
  }
  if (path === "/ptqrlogin") {
    return jsonResponse("ptuiCB('0','0','https://ssl.ptlogin2.graph.qq.com/check_sig?uin=123&ptsigx=abc','0','登录成功！', '')");
  }
  if (path === "/check_sig") {
    return jsonResponse("ok", { headers: { "set-cookie": "p_skey=psk-1; Path=/; Domain=.qq.com" } });
  }
  if (path === "/oauth2.0/authorize") {
    return jsonResponse("", {
      status: 302,
      headers: { location: "https://y.qq.com/portal/wx_redirect.html?code=oauth-code&state=state" },
    });
  }
  if (path === "/cgi-bin/musicu.fcg") {
    const call = callOf(init.body);
    const module = call?.module || "";
    const method = call?.method || "";
    if (module === "QQConnectLogin.LoginServer") {
      return jsonResponse({ code: 0, req_0: { code: 0, data: { musicid: "123456", musickey: "key-1", nick: "周韬" } } });
    }
    if (method === "GetAll") {
      return jsonResponse({
        code: 0,
        req_0: { code: 0, data: { group: [{ toplist: [{ topId: 62, title: "飙升榜", period: "2026-11-07", intro: "每天更新" }] }] } },
      });
    }
    if (method === "GetDetail") {
      return jsonResponse({
        code: 0,
        req_0: {
          code: 0,
          data: { songInfoList: [{ id: 97773, mid: "0039MnYb0qxYhV", name: "晴天", interval: 269, singer: [{ mid: "0025NhlN2yWrP4", name: "周杰伦" }], album: { mid: "000MkMni19ClKG", name: "叶惠美" } }] },
        },
      });
    }
    if (method === "get_new_song_info") {
      return jsonResponse({
        code: 0,
        req_0: { code: 0, data: { songlist: [{ id: 1, mid: "newsongmid0001", name: "新歌", interval: 200, singer: [{ name: "甲" }], album: { name: "专辑" } }] } },
      });
    }
    if (method === "GetRecommendFeed") {
      return jsonResponse({
        code: 0,
        req_0: { code: 0, data: { List: [{ Playlist: { basic: { tid: 88, title: "推荐歌单", desc: "热门", song_cnt: 12, cover: { medium_url: "https://y.qq.com/cover.jpg" } } } }] } },
      });
    }
    if (method === "get_recommend_feed") {
      return jsonResponse({
        code: 0,
        req_0: { code: 0, data: { v_shelf: [{ v_niche: [{ v_card: [{ type: 200, id: "97773", title: "晴天" }] }] }] } },
      });
    }
    if (method === "CgiGetTrackInfo") {
      return jsonResponse({
        code: 0,
        req_0: {
          code: 0,
          data: { tracks: [{ id: 97773, mid: "0039MnYb0qxYhV", name: "晴天", interval: 269, singer: [{ mid: "0025NhlN2yWrP4", name: "周杰伦" }], album: { mid: "000MkMni19ClKG", name: "叶惠美" }, file: { media_mid: "0039MnYb0qxYhV" } }] },
        },
      });
    }
    if (method === "get_radio_track") {
      return jsonResponse({
        code: 0,
        req_0: { code: 0, data: { tracks: [{ id: 97773, mid: "0039MnYb0qxYhV", name: "猜你喜欢", interval: 180, singer: [{ name: "乙" }] }] } },
      });
    }
    if (method === "GetRadarSong") {
      return jsonResponse({
        code: 0,
        req_0: { code: 0, data: { VecSongs: [{ Track: { id: 5, mid: "radarmid0000001", name: "雷达", interval: 100, singer: [] } }] } },
      });
    }
    if (method === "GetPlayLyricInfo") {
      const lrc = Buffer.from("[00:01.00]晴天\n[00:05.00]故事").toString("base64");
      return jsonResponse({ code: 0, req_0: { code: 0, data: { lyric: lrc, trans: "" } } });
    }
    if (method === "UrlGetVkey") {
      const filename = call.param.filename[0];
      const empty = filename.startsWith("F000");
      return jsonResponse({
        code: 0,
        req_0: {
          code: 0,
          data: {
            sip: ["http://aqqmusic.tc.qq.com/"],
            midurlinfo: [{ filename, purl: empty ? "" : "M8000039MnYb0qxYhV.mp3", result: empty ? 1 : 0 }],
          },
        },
      });
    }
    if (method === "GetPlayRecentlyInfo") {
      return jsonResponse({
        code: 0,
        "music.musicasset.PlayRecentlyRead.GetPlayRecentlyInfo": {
          code: 0,
          data: { code: 0, data: { songList: [{ track: { id: 97773, mid: "0039MnYb0qxYhV", name: "听过", interval: 10, singer: [{ name: "周杰伦" }] } }] } },
        },
      });
    }
    if (method === "AddSonglist" || method === "DelSonglist" || method === "AddPlaylist" || method === "EditPlaylist" || method === "DelPlaylist" || method === "ReportPlayRecentlyInfo") {
      writes.push(call);
      return jsonResponse({ code: 0, [module + "." + method]: { code: 0, data: { retCode: 0, result: { dirId: 7, tid: 70 } } } });
    }
    if (module === "music.search.SearchCgiService") {
      return jsonResponse({
        code: 0,
        "music.search.SearchCgiService": {
          code: 0,
          data: { meta: { nextpage: 0 }, body: { singer: { list: [{ singerMID: "0025NhlN2yWrP4", singerName: "周杰伦" }] } } },
        },
      });
    }
    return jsonResponse({ code: 0, req_0: { code: 0, data: {} } });
  }
  if (path.endsWith("/fcg_get_profile_homepage.fcg")) {
    return jsonResponse({ code: 0, data: { creator: { nick: "周韬", headpic: "https://y.qq.com/avatar.jpg" } } });
  }
  if (path.endsWith("/fcg_user_created_diss")) {
    return jsonResponse({
      code: 0,
      data: {
        disslist: [
          { dirid: 201, tid: 9001, diss_name: "我喜欢", diss_cover: "", song_cnt: 2 },
          { dirid: 3, tid: 9002, diss_name: "自建", song_cnt: 1 },
        ],
      },
    });
  }
  if (path.endsWith("/fcg_get_profile_order_asset.fcg")) {
    return jsonResponse({ code: 0, data: { cdlist: [{ dissid: 9003, dissname: "收藏", logo: "", songnum: 4 }] } });
  }
  if (path.endsWith("/client_search_cp")) {
    return jsonResponse({
      code: 0,
      data: { song: { totalnum: 1, list: [{ songid: 97773, songmid: "0039MnYb0qxYhV", songname: "晴天", interval: 269, singer: [{ mid: "0025NhlN2yWrP4", name: "周杰伦" }], albummid: "000MkMni19ClKG", albumname: "叶惠美" }] } },
    });
  }
  if (path.endsWith("/smartbox_new.fcg")) {
    return jsonResponse({ code: 0, data: { song: { itemlist: [{ name: "晴天" }] }, singer: { itemlist: [{ name: "周杰伦" }] } } });
  }
  if (path.includes("uniform") || path.endsWith("/fcg_query_lyric_new.fcg")) {
    return jsonResponse({ code: 0, lyric: "[00:01.00]晴天" });
  }
  return jsonResponse({ code: 0, data: {} });
};

test("QQ scan sign-in stores the session and never asks for a cookie", async () => {
  assert.equal(await plugin.account(), null);
  await plugin.signIn();
  assert.equal(prompts[0].qr, "http://txz.qq.com/p?k=scan-token&f=716027609");
  assert.equal(prompts[0].text, "Scan with QQ to sign in to QQ Music");
  assert.equal(prompts[0].qr.includes("cookie"), false);
  const who = await plugin.account();
  assert.equal(who.name, "周韬");
  assert.equal(who.page, "me");
  const saved = storage.get("session");
  assert.equal(saved.musicid, "123456");
  assert.equal(saved.musickey, "key-1");
  assert.equal(saved.cookie, undefined);
});

test("playlists keep liked songs fixed and collected lists saved", async () => {
  const list = await plugin.playlists();
  assert.deepEqual(
    list.map((item) => [item.name, item.mine, item.fixed]),
    [
      ["我喜欢", true, true],
      ["自建", true, false],
      ["收藏", false, false],
    ],
  );
  await assert.rejects(plugin.renamePlaylist({ id: list[0].id, name: "别的" }), (error) => error.code === "unsupported");
});

test("search, suggestions, recommendations, listening modes, history, lyrics and stream", async () => {
  const found = await plugin.search({ query: "晴天", kind: "tracks", offset: 0 });
  assert.equal(found.tracks[0].id, "0039MnYb0qxYhV");
  assert.equal(found.tracks[0].artists[0].name, "周杰伦");
  assert.equal(found.tracks[0].duration, 269000);
  const artists = await plugin.search({ query: "周杰伦", kind: "artists", offset: 0 });
  assert.equal(artists.artists[0].id, "0025NhlN2yWrP4");
  assert.deepEqual(await plugin.suggest({ query: "晴" }), ["晴天", "周杰伦"]);

  const page = await plugin.home();
  assert.equal(page.sections[0].title, "For You");
  assert.equal(page.sections[0].tracks[0].name, "晴天");
  assert.equal(page.sections[1].playlists[0].name, "推荐歌单");
  assert.equal(page.sections[2].links[0].page, "chart:62:2026-11-07");

  const modes = await plugin.stations();
  assert.equal(modes[0].id, "radio:99");
  assert.equal(modes[1].id, "radar");
  const next = await plugin.stationNext({ id: "radio:99" });
  assert.equal(next[0].name, "猜你喜欢");
  const radar = await plugin.stationNext({ id: "radar" });
  assert.equal(radar[0].id, "radarmid0000001");

  const history = await plugin.recent();
  assert.equal(history[0].name, "听过");
  const historyPage = await plugin.browse({ page: "history" });
  assert.equal(historyPage.sections[0].tracks[0].id, "0039MnYb0qxYhV");

  await plugin.like({ id: "0039MnYb0qxYhV", on: true });
  const liked = writes.find((call) => call.method === "AddSonglist");
  assert.equal(liked.param.dirId, 201);
  assert.equal(liked.param.v_songInfo[0].songId, 97773);

  const words = await plugin.lyrics({ id: "0039MnYb0qxYhV" });
  assert.equal(words.lines[0].text, "晴天");
  assert.equal(words.lines[1].text, "故事");
  assert.equal(words.lines[0].start, 1000);

  const audio = await plugin.stream({ id: "0039MnYb0qxYhV", quality: "highest" });
  assert.equal(audio.type, "mp3");
  assert.equal(audio.url, "https://aqqmusic.tc.qq.com/M8000039MnYb0qxYhV.mp3");
  assert.equal(audio.url.includes("F000"), false);
});

test("a signed-out account is empty after sign-out", async () => {
  await plugin.signOut();
  assert.equal(await plugin.account(), null);
  assert.deepEqual(await plugin.recent(), []);
});
