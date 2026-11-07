// QQ Music source for MyGo Music.
// Sign-in is QQ's web QR: the service returns a scan link, and the app draws it.
// The session stays in plugin storage. Playback uses plain file URLs only.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const JSON_GATEWAY = "https://u.y.qq.com/cgi-bin/musicu.fcg";
const DESKTOP_GATEWAY = "https://u6.y.qq.com/cgi-bin/musicu.fcg";
const PT_REFERER = "https://xui.ptlogin2.qq.com/";
const CLIENT_ID = "100497308";
const LIKED_DIR = 201;

const QUALITY = [
  { prefix: "F000", ext: "flac", type: "flac" },
  { prefix: "M800", ext: "mp3", type: "mp3" },
  { prefix: "M500", ext: "mp3", type: "mp3" },
  { prefix: "C400", ext: "m4a", type: "m4a" },
];

let memory = null;
let songIndex = null;
let libraryCache = null;
let likedCache = null;
const stationPages = new Map();
const radarSeeds = [];

function t(text) {
  return host.t(text);
}

function problem(code, message) {
  const error = new Error(t(message));
  error.code = code;
  throw error;
}

function load() {
  if (memory) return memory;
  const saved = host.storage.get("session");
  memory = saved && typeof saved === "object" ? { ...saved } : {};
  return memory;
}

function save() {
  host.storage.set("session", {
    musicid: memory.musicid || "",
    musickey: memory.musickey || "",
    loginType: memory.loginType || 2,
    name: memory.name || "",
    imageUrl: memory.imageUrl || "",
  });
}

function songs() {
  if (songIndex) return songIndex;
  const saved = host.storage.get("songs");
  songIndex = new Map(Object.entries(saved && typeof saved === "object" ? saved : {}));
  return songIndex;
}

function remember(song) {
  const mid = song?.mid || song?.songmid;
  if (!mid) return;
  const previous = songs().get(String(mid)) || {};
  const id = song.id ?? song.songid ?? previous.id;
  const media = song.file?.media_mid || song.media_mid || song.strMediaMid || previous.media || String(mid);
  songs().set(String(mid), { id: id == null ? previous.id : String(id), media: String(media) });
  const entries = [...songs().entries()].slice(-1500);
  host.storage.set("songs", Object.fromEntries(entries));
}

function loggedIn() {
  const session = load();
  return Boolean(session.musicid && session.musickey);
}

function requireLogin() {
  if (!loggedIn()) problem("signIn", "Sign in to QQ Music");
}

function cookieHeader() {
  const session = load();
  if (!session.musicid || !session.musickey) return "";
  const id = session.musicid;
  const key = session.musickey;
  const type = session.loginType || 2;
  return `uin=${id}; qqmusic_uin=${id}; qqmusic_key=${key}; qm_keyst=${key}; tmeLoginType=${type}`;
}

function hash33(value, init) {
  let hash = init;
  for (const char of String(value)) {
    hash = (hash + ((hash << 5) + char.codePointAt(0))) >>> 0;
  }
  return hash & 0x7fffffff;
}

function gtk() {
  const key = load().musickey;
  return key ? hash33(key, 5381) : 5381;
}

function guid() {
  const saved = host.storage.get("guid");
  if (typeof saved === "string" && saved.length >= 16) return saved;
  const alphabet = "0123456789ABCDEF";
  let next = "";
  for (let i = 0; i < 32; i++) next += alphabet[(Math.random() * 16) | 0];
  host.storage.set("guid", next);
  return next;
}

function numberStarts(out) {
  for (let i = out.length - 1; i >= 0; i--) {
    const prev = out[i];
    if (prev === " " || prev === "\n" || prev === "\r" || prev === "\t") continue;
    return prev === ":" || prev === "," || prev === "[";
  }
  return true;
}

function parseJson(text) {
  let source = String(text).trim();
  if (!source.startsWith("{") && !source.startsWith("[")) {
    source = source.replace(/^[^(]*\(/, "").replace(/\);?\s*$/, "");
  }
  const out = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      out.push(ch);
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out.push(ch);
      continue;
    }
    if ((ch === "-" || (ch >= "0" && ch <= "9")) && numberStarts(out)) {
      let j = i;
      if (source[j] === "-") j++;
      const digits = j;
      while (j < source.length && source[j] >= "0" && source[j] <= "9") j++;
      const next = source[j];
      if (next !== "." && next !== "e" && next !== "E" && j - digits >= 16) {
        out.push(`"${source.slice(i, j)}"`);
        i = j - 1;
        continue;
      }
    }
    out.push(ch);
  }
  return JSON.parse(out.join(""));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bytesToString(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i++];
    if (b < 128) out += String.fromCharCode(b);
    else if (b < 224) out += String.fromCharCode(((b & 31) << 6) | (bytes[i++] & 63));
    else if (b < 240) out += String.fromCharCode(((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63));
    else out += String.fromCodePoint(((b & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63));
  }
  return out;
}

function decodeBase64(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = String(value).replace(/[^A-Za-z0-9+/]/g, "");
  const bytes = [];
  for (let i = 0; i < clean.length; i += 4) {
    const a = alphabet.indexOf(clean[i]);
    const b = alphabet.indexOf(clean[i + 1]);
    const c = alphabet.indexOf(clean[i + 2]);
    const d = alphabet.indexOf(clean[i + 3]);
    if (a < 0 || b < 0) break;
    bytes.push((a << 2) | (b >> 4));
    if (c >= 0) bytes.push(((b & 15) << 4) | (c >> 2));
    if (d >= 0) bytes.push(((c & 3) << 6) | d);
  }
  return bytesToString(bytes);
}

function lyricText(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  if (value.includes("[")) return value;
  try {
    const decoded = decodeBase64(value);
    if (decoded.includes("[") || decoded.includes("词")) return decoded;
  } catch {
    // The line was already plain text.
  }
  return value;
}

function parseLrc(content) {
  const lines = [];
  for (const raw of String(content).split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!tags.length) continue;
    const text = raw.slice(raw.lastIndexOf("]") + 1).trim();
    if (!text) continue;
    for (const tag of tags) lines.push({ start: Math.round((Number(tag[1]) * 60 + Number(tag[2])) * 1000), text });
  }
  lines.sort((a, b) => a.start - b.start);
  return lines.map((line, index) => {
    const end = lines[index + 1]?.start ?? line.start + 1000;
    return { start: line.start, end, text: line.text, words: [{ start: line.start, end, text: line.text }] };
  });
}

function cover(mid, kind) {
  if (!mid) return undefined;
  const type = kind === "artist" ? "T001" : "T002";
  return `https://y.gtimg.cn/music/photo_new/${type}R800x800M000${mid}.jpg`;
}

function toTrack(song) {
  const raw = song?.track || song?.songInfo || song;
  if (!raw) return null;
  const mid = raw.mid || raw.songmid;
  if (!mid) return null;
  remember(raw);
  const singers = raw.singer || [];
  const album = raw.album && typeof raw.album === "object" ? raw.album : {};
  const albumMid = album.mid || raw.albummid || "";
  const albumName = album.name || raw.albumname || "";
  return {
    id: String(mid),
    name: raw.name || raw.songname || raw.title || "",
    artists: singers
      .map((singer) => ({ id: singer.mid || (singer.id == null ? "" : String(singer.id)), name: singer.name || "" }))
      .filter((singer) => singer.name),
    album: albumMid || albumName ? { id: String(albumMid || album.id || ""), name: albumName } : undefined,
    duration: Math.round(Number(raw.interval || 0) * 1000),
    imageUrl: cover(albumMid, "album"),
  };
}

function tracksFrom(list) {
  return (list || []).map(toTrack).filter(Boolean);
}

function toAlbum(item) {
  if (!item) return null;
  const id = item.albumMID || item.albumMid || item.mid;
  const name = item.albumName || item.name || item.title;
  if (!id && !name) return null;
  const singer = item.singerName || item.singer_list?.[0]?.name || item.singer?.[0]?.name || "";
  return {
    id: String(id || name),
    name: name || "",
    artist: singer ? { name: singer } : undefined,
    imageUrl: cover(id, "album"),
  };
}

function toArtist(item) {
  if (!item) return null;
  const basic = item.basic_info || item;
  const id = basic.singer_mid || basic.singerMID || item.singerMID || item.mid;
  const name = basic.name || basic.singer_name || item.singerName || item.name;
  if (!id && !name) return null;
  return {
    id: String(id || name),
    name: name || "",
    imageUrl: item.pic?.pic || cover(id, "artist"),
  };
}

function toPlaylistBrief(item, extra = {}) {
  if (!item) return null;
  const id = item.id;
  const name = item.name || item.title;
  if (!id || !name) return null;
  return {
    id: String(id),
    name,
    description: item.description || "",
    imageUrl: item.imageUrl || undefined,
    trackCount: Number(item.trackCount || 0) || undefined,
    mine: Boolean(extra.mine),
    fixed: Boolean(extra.fixed),
  };
}

async function request(url, options = {}) {
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    problem("unavailable", "Could not reach QQ Music");
  }
  if (!response.ok && response.status !== 301 && response.status !== 302) {
    problem("unavailable", "Could not reach QQ Music");
  }
  return response;
}

async function readJson(response) {
  return parseJson(await response.text());
}

function splitSetCookie(value) {
  return String(value).split(/,(?=\s*[!#$%&'*+\-.^_`|~0-9A-Za-z]+=)/);
}

function absorbCookies(response, jar) {
  const list = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  if (!list.length) {
    const single = response.headers.get("set-cookie");
    if (single) list.push(...splitSetCookie(single));
  }
  for (const raw of list) {
    const parts = String(raw).split(";");
    const pair = parts[0];
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    // A hop may clear a cookie after another hop set the ticket under the same
    // name for a different domain. Ignoring cleared and expired cookies is what
    // makes check_sig's p_skey survive the redirect to login_jump.
    if (!name || !value) continue;
    const attributes = parts.slice(1).map((part) => part.trim());
    const maxAge = attributes.find((part) => /^max-age=/i.test(part));
    if (maxAge && Number(maxAge.slice(maxAge.indexOf("=") + 1)) <= 0) continue;
    const expires = attributes.find((part) => /^expires=/i.test(part));
    if (expires) {
      const when = Date.parse(expires.slice(expires.indexOf("=") + 1).trim());
      if (Number.isFinite(when) && when <= Date.now()) continue;
    }
    jar.set(name, value);
  }
}

function jarHeader(jar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function musicu(module, method, param, mode = "json") {
  const session = load();
  const common = {
    cv: 4747474,
    ct: 24,
    format: "json",
    inCharset: "utf-8",
    outCharset: "utf-8",
    notice: 0,
    platform: "yqq.json",
    needNewCode: 1,
    uin: session.musicid || "0",
    g_tk: gtk(),
    g_tk_new_20200303: gtk(),
  };
  if (session.musickey) {
    common.authst = session.musickey;
    common.tmeLoginType = session.loginType || 2;
  }
  let key = "req_0";
  let gateway = JSON_GATEWAY;
  let contentType = "application/json";
  const body = { comm: common };
  if (mode === "desktop" || mode === "private") {
    gateway = DESKTOP_GATEWAY;
    contentType = "application/x-www-form-urlencoded";
    body.comm = {
      ct: "19",
      cv: "2276",
      _channelid: "20",
      _os_version: "6.2.9200-2",
      patch: "118",
      tmeAppID: "qqmusic",
      guid: guid(),
      uin: session.musicid || "0",
      authst: session.musickey || "",
      tmeLoginType: session.loginType || 2,
    };
    key = mode === "private" ? `${module}.${method}` : module;
  }
  body[key] = { module, method, param };
  const headers = {
    "user-agent": UA,
    referer: "https://y.qq.com/",
    origin: "https://y.qq.com",
    "content-type": contentType,
  };
  const cookie = cookieHeader();
  if (cookie) headers.cookie = cookie;
  const response = await request(gateway, { method: "POST", headers, body: JSON.stringify(body) });
  const json = await readJson(response);
  const payload = json[key];
  const code = payload?.code;
  if (code === 1000 || json.code === 1000) problem("signIn", "Sign in to QQ Music");
  if (!payload || code !== 0) throw new Error(t("Could not reach QQ Music"));
  return payload.data;
}

async function cgi(url) {
  const headers = { "user-agent": UA, referer: "https://y.qq.com/" };
  const cookie = cookieHeader();
  if (cookie) headers.cookie = cookie;
  const target = new URL(url);
  if (!target.searchParams.has("g_tk")) target.searchParams.set("g_tk", String(gtk()));
  const response = await request(target, { headers });
  const json = await readJson(response);
  if (json.code === 1000 || json.code === 10001) problem("signIn", "Sign in to QQ Music");
  return json;
}

function chainFor(quality) {
  const name = String(quality || "").toLowerCase();
  if (name.includes("low")) return QUALITY.slice(3);
  if (name.includes("standard") || name.includes("128")) return QUALITY.slice(2);
  if (name.includes("high") || name.includes("320")) return QUALITY.slice(1);
  return QUALITY;
}

function joinStream(sip, purl) {
  const path = String(purl).replace(/^http:/, "https:");
  if (/^https?:/.test(path)) return path;
  const bases = Array.isArray(sip) ? sip : [];
  const base = (bases.find((item) => String(item).startsWith("https://")) || bases[0] || "https://aqqmusic.tc.qq.com/").replace(/^http:/, "https:");
  return `${String(base).replace(/\/?$/, "/")}${path.replace(/^\//, "")}`;
}

function playlistId(kind, dirId, tid) {
  return kind === "mine" ? `mine:${dirId}:${tid}` : `diss:${tid}`;
}

function parsePlaylistId(id) {
  const text = String(id);
  if (text.startsWith("mine:")) {
    const [, dirId, tid] = text.split(":");
    return { mine: true, dirId: Number(dirId), tid: Number(tid) };
  }
  if (text.startsWith("diss:")) return { mine: false, tid: Number(text.slice(5)) };
  return { mine: false, tid: Number(text) };
}

async function diss(tid, begin = 0, num = 1000) {
  const data = await musicu("music.srfDissInfo.aiDissInfo", "uniform_get_Dissinfo", {
    disstid: Number(tid),
    enc_host_uin: "",
    tag: 1,
    userinfo: 1,
    song_begin: begin,
    song_num: num,
    onlysonglist: 0,
    orderlist: 1,
  });
  const info = data?.dirinfo || {};
  return {
    name: info.title || info.dissname || "",
    description: info.desc || "",
    imageUrl: info.picurl || info.cover || undefined,
    trackCount: Number(info.songnum || data?.total_song_num || 0) || undefined,
    tracks: tracksFrom(data?.songlist),
    more: data?.hasmore === 1 || data?.hasmore === true,
  };
}

async function myLists() {
  if (libraryCache) return libraryCache;
  requireLogin();
  const createdUrl = `https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss?hostuin=${encodeURIComponent(load().musicid)}&sin=0&size=200&format=json`;
  const savedUrl = `https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg?ct=20&cid=205360956&userid=${encodeURIComponent(load().musicid)}&reqtype=3&sin=0&ein=200&format=json`;
  const [createdJson, savedJson] = await Promise.all([
    cgi(createdUrl).catch(() => ({})),
    cgi(savedUrl).catch(() => ({})),
  ]);
  const created = (createdJson.data?.disslist || createdJson.disslist || []).map((item) => ({
    dirId: Number(item.dirid),
    tid: Number(item.tid),
    name: item.diss_name || item.dissname || item.title || "",
    imageUrl: item.diss_cover || item.logo || undefined,
    trackCount: Number(item.song_cnt || item.songnum || 0),
    mine: true,
    fixed: Number(item.dirid) === LIKED_DIR,
  }));
  const saved = (savedJson.data?.cdlist || []).map((item) => ({
    dirId: 0,
    tid: Number(item.dissid),
    name: item.dissname || "",
    imageUrl: item.logo || undefined,
    trackCount: Number(item.songnum || 0),
    mine: false,
    fixed: false,
  }));
  libraryCache = [...created.filter((item) => item.tid), ...saved.filter((item) => item.tid)];
  return libraryCache;
}

function invalidateLibrary() {
  libraryCache = null;
  likedCache = null;
}

async function songIdOf(mid) {
  const known = songs().get(String(mid));
  if (known?.id) return Number(known.id);
  const data = await musicu("music.trackInfo.UniformRuleCtrl", "CgiGetTrackInfo", {
    ctx: 0,
    client: 1,
    types: [0],
    modify_stamp: [0],
    mids: [String(mid)],
  });
  const track = data?.tracks?.[0];
  if (track) remember(track);
  const id = track?.id ?? track?.songid;
  if (id == null) problem("unavailable", "This song can't be played");
  return Number(id);
}

async function newSongs() {
  const data = await musicu("newsong.NewSongServer", "get_new_song_info", { type: 5 });
  return tracksFrom(data?.songlist).slice(0, 30);
}

async function chartIndex() {
  const data = await musicu("musicToplist.ToplistInfoServer", "GetAll", {});
  const charts = [];
  for (const group of data?.group || []) {
    for (const chart of group.toplist || []) {
      if (chart.topId == null) continue;
      charts.push({
        id: chart.topId,
        title: chart.title || "",
        period: chart.period || "",
        description: chart.intro || chart.titleDetail || "",
      });
    }
  }
  return charts;
}

async function chartTracks(chart, num = 30) {
  const data = await musicu("musicToplist.ToplistInfoServer", "GetDetail", {
    topId: chart.id,
    offset: 0,
    num,
    period: chart.period,
  });
  return tracksFrom(data?.songInfoList || data?.data?.songInfoList);
}

async function recommendedPlaylists() {
  const data = await musicu("music.playlist.PlaylistSquare", "GetRecommendFeed", { From: 0, Size: 18 });
  return (data?.List || [])
    .map((item) => {
      const basic = item.Playlist?.basic || item.basic;
      if (!basic?.tid || !basic.title) return null;
      return toPlaylistBrief({
        id: playlistId("diss", 0, basic.tid),
        name: basic.title,
        description: basic.desc || "",
        imageUrl: basic.cover?.medium_url || basic.cover?.small_url,
        trackCount: basic.song_cnt,
      });
    })
    .filter(Boolean);
}

async function forYou() {
  const data = await musicu("music.recommend.RecommendFeed", "get_recommend_feed", {
    direction: 0,
    page: 1,
    v_cache: [],
    v_uniq: [],
    s_num: 0,
  });
  const cards = [];
  for (const shelf of data?.v_shelf || []) {
    for (const niche of shelf.v_niche || []) cards.push(...(niche.v_card || []));
  }
  const daily = cards.find((card) => card.subtype === 510 && card.id);
  if (daily) return (await diss(daily.id, 0, 30)).tracks;
  const ids = cards.filter((card) => card.type === 200 && card.id).map((card) => Number(card.id)).filter((id) => id > 0);
  if (!ids.length) return [];
  const info = await musicu("music.trackInfo.UniformRuleCtrl", "CgiGetTrackInfo", {
    ids,
    types: ids.map(() => 0),
  });
  return tracksFrom(info?.tracks).slice(0, 30);
}

function ptuiArgs(text) {
  return [...String(text).matchAll(/'([^']*)'/g)].map((match) => jsUnescape(match[1]));
}

function jsUnescape(value) {
  return String(value)
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\\//g, "/")
    .replace(/\\'/g, "'")
    .replace(/&amp;/g, "&");
}

function rawQuery(url, key) {
  const query = String(url).split("?")[1]?.split("#")[0] || "";
  for (const part of query.split("&")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index) !== key) continue;
    return part.slice(index + 1);
  }
  return "";
}

function deviceId() {
  const saved = host.storage.get("deviceId");
  if (typeof saved === "string" && /^\d{10}$/.test(saved)) return saved;
  let next = "";
  for (let i = 0; i < 10; i++) next += String((Math.random() * 10) | 0);
  host.storage.set("deviceId", next);
  return next;
}

function failLogin(step) {
  console.error(`QQ Music sign-in stopped at ${step}`);
  problem("signIn", "QQ Music didn't finish signing in.");
}

async function pollQr(qrsig) {
  const url = new URL("https://ssl.ptlogin2.qq.com/ptqrlogin");
  const query = {
    u1: "https://graph.qq.com/oauth2.0/login_jump",
    ptqrtoken: String(hash33(qrsig, 0)),
    ptredirect: "0",
    h: "1",
    t: "1",
    g: "1",
    from_ui: "1",
    ptlang: "2052",
    action: `0-0-${Date.now()}`,
    js_ver: "20102616",
    js_type: "1",
    pt_uistyle: "40",
    aid: "716027609",
    daid: "383",
    pt_3rd_aid: CLIENT_ID,
    has_onekey: "1",
  };
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await request(url, {
    headers: { "user-agent": UA, referer: PT_REFERER, cookie: `qrsig=${qrsig}` },
  });
  const args = ptuiArgs(await response.text());
  return { code: args[0] || "", url: args[2] || "" };
}

async function followCookies(startUrl, jar) {
  let current = startUrl;
  let referer = PT_REFERER;
  for (let hop = 0; hop < 5; hop++) {
    const headers = { "user-agent": UA, referer };
    if (jar.size) headers.cookie = jarHeader(jar);
    const response = await request(current, { redirect: "manual", headers });
    absorbCookies(response, jar);
    const location = response.headers.get("location");
    if (!location || response.status < 300 || response.status >= 400) return response;
    referer = current;
    current = new URL(location, current).href;
  }
  return null;
}

async function exchange(checkUrl) {
  const uin = rawQuery(checkUrl, "uin");
  const ptsigx = rawQuery(checkUrl, "ptsigx");
  if (!uin || !ptsigx) failLogin("callback");
  const check =
    "https://ssl.ptlogin2.graph.qq.com/check_sig?uin=" +
    uin +
    "&pttype=1&service=ptqrlogin&nodirect=0&ptsigx=" +
    ptsigx +
    "&s_url=" +
    encodeURIComponent("https://graph.qq.com/oauth2.0/login_jump") +
    "&ptlang=2052&ptredirect=100&aid=716027609&daid=383" +
    "&j_later=0&low_login_hour=0&regmaster=0&pt_login_type=3&pt_aid=0&pt_aaid=16&pt_light=0" +
    "&pt_3rd_aid=" +
    CLIENT_ID;
  const jar = new Map();
  await followCookies(check, jar);
  const pSkey = jar.get("p_skey");
  if (!pSkey) failLogin(`p_skey missing: ${[...jar.keys()].join(",") || "no cookies"}`);
  const form = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: "https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/",
    scope: "get_user_info,get_app_friends",
    state: "state",
    switch: "",
    from_ptlogin: "1",
    src: "1",
    update_auth: "1",
    openapi: "1010_1030",
    g_tk: String(hash33(pSkey, 5381)),
    auth_time: String(Date.now()),
    ui: `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`,
  });
  const authorized = await request("https://graph.qq.com/oauth2.0/authorize", {
    method: "POST",
    redirect: "manual",
    headers: {
      "user-agent": UA,
      referer: "https://graph.qq.com/oauth2.0/authorize",
      origin: "https://graph.qq.com",
      cookie: jarHeader(jar),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const location = authorized.headers.get("location") || "";
  let code = "";
  try {
    code = new URL(location, "https://y.qq.com").searchParams.get("code") || "";
  } catch {
    code = "";
  }
  if (!code) {
    const body = await authorized.text();
    code = body.match(/[?&]code=([^&"']+)/)?.[1] || "";
  }
  if (!code) failLogin("oauth code");
  const data = await loginWithCode(code);
  const musicid = data?.musicid ?? data?.musicID ?? data?.str_musicid ?? data?.uin;
  const musickey = data?.musickey ?? data?.qm_keyst ?? data?.key;
  if (musicid == null || musicid === "" || !musickey) failLogin("musickey");
  const session = load();
  session.musicid = String(musicid);
  session.musickey = String(musickey);
  session.loginType = String(musickey).startsWith("W_X") ? 1 : 2;
  session.name = data.nick || data.nickname || "";
  save();
  invalidateLibrary();
}

export async function signIn() {
  const url = new URL("https://ssl.ptlogin2.qq.com/ptqrshow");
  const query = {
    appid: "716027609",
    daid: "383",
    pt_3rd_aid: CLIENT_ID,
    u1: "https://graph.qq.com/oauth2.0/login_jump",
    s: "8",
    e: "0",
    type: "1",
    t: String(Math.random()),
  };
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await request(url, { headers: { "user-agent": UA, referer: PT_REFERER } });
  const jar = new Map();
  absorbCookies(response, jar);
  const qrsig = jar.get("qrsig");
  const payload = parseJson((await response.text()).replace(/^ptui_qrcode_CB\(/, "").replace(/\);?\s*$/, ""));
  if (!qrsig || !payload?.qrcode) problem("signIn", "QQ Music didn't finish signing in.");
  const qr = String(payload.qrcode);
  host.signInPrompt?.({ qr, text: t("Scan with QQ to sign in to QQ Music") });
  const deadline = Date.now() + 170000;
  let scanned = false;
  while (Date.now() < deadline) {
    const status = await pollQr(qrsig);
    if (status.code === "0" && status.url) {
      await exchange(status.url);
      const who = await account();
      if (who) return who;
      const session = load();
      return { id: session.musicid, name: session.name || t("QQ Music"), page: "me" };
    }
    if (status.code === "65") problem("signIn", "The QR code expired. Sign in again.");
    if (status.code === "68") problem("signIn", "QQ refused the login");
    if (status.code === "67" && !scanned) {
      scanned = true;
      host.signInPrompt?.({ qr, text: t("Confirm the login on your phone") });
    }
    await sleep(2000);
  }
  throw new Error(t("Signing in timed out. Try again."));
}

export async function signOut() {
  const session = load();
  session.musicid = "";
  session.musickey = "";
  session.name = "";
  session.imageUrl = "";
  save();
  invalidateLibrary();
}

async function loginWithCode(code) {
  const key = "QQConnectLogin.LoginServer.QQLogin";
  const body = {
    comm: {
      ct: "11",
      cv: "13020508",
      v: "13020508",
      tmeAppID: "qqmusic",
      format: "json",
      inCharset: "utf-8",
      outCharset: "utf-8",
      uid: deviceId(),
      tmeLoginType: "2",
    },
    [key]: {
      module: "QQConnectLogin.LoginServer",
      method: "QQLogin",
      param: { code },
    },
  };
  const response = await request(JSON_GATEWAY, {
    method: "POST",
    headers: {
      "user-agent": UA,
      referer: "https://y.qq.com/",
      origin: "https://y.qq.com",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await readJson(response);
  const payload = json[key] || json.req_0;
  if (payload?.code === 1000 || json.code === 1000 || !payload || payload.code !== 0) {
    failLogin(`QQLogin ${payload?.code ?? json.code ?? "empty"}`);
  }
  return payload.data || {};
}

async function profile() {
  requireLogin();
  const json = await cgi(
    `https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg?format=json&cid=205360838&userid=${encodeURIComponent(load().musicid)}&reqfrom=1`,
  );
  const creator = json.data?.creator || {};
  if (creator.nick) {
    const session = load();
    session.name = creator.nick;
    session.imageUrl = creator.headpic || "";
    save();
  }
  return creator;
}

export async function account() {
  if (!loggedIn()) return null;
  try {
    const creator = await profile();
    const session = load();
    return {
      id: session.musicid,
      name: creator.nick || session.name || t("QQ Music"),
      imageUrl: creator.headpic || session.imageUrl || undefined,
      page: "me",
    };
  } catch (error) {
    if (error.code === "signIn") return null;
    const session = load();
    return { id: session.musicid, name: session.name || t("QQ Music"), page: "me" };
  }
}

export async function home() {
  const [personal, fresh, playlists, charts] = await Promise.all([
    loggedIn() ? forYou().catch(() => []) : Promise.resolve([]),
    newSongs().catch(() => []),
    recommendedPlaylists().catch(() => []),
    chartIndex().catch(() => []),
  ]);
  let tracks = personal.length ? personal : fresh;
  if (!tracks.length && charts[0]) tracks = await chartTracks(charts[0]).catch(() => []);
  const sections = [];
  if (tracks.length) {
    sections.push(
      personal.length
        ? { title: t("For You"), subtitle: t("Picked from what you play"), pageTitle: t("For You"), tracks }
        : { title: t("New Songs"), subtitle: t("Songs released recently"), pageTitle: t("New Songs"), tracks },
    );
  }
  if (playlists.length) sections.push({ title: t("Recommended Playlists"), playlists });
  const links = charts.map((chart) => ({
    title: chart.title,
    subtitle: chart.description,
    page: `chart:${chart.id}:${encodeURIComponent(chart.period)}`,
  }));
  if (links.length) sections.push({ title: t("Charts"), links });
  return { title: t("QQ Music"), sections };
}

export async function browse({ page }) {
  if (page === "history") {
    const tracks = await recent();
    return {
      title: t("Play History"),
      subtitle: t("Songs you played"),
      sections: [{ title: t("Play History"), tracks, empty: t("Songs you played") }],
    };
  }
  if (page === "charts") {
    const charts = await chartIndex();
    return {
      title: t("Charts"),
      sections: [
        {
          title: t("Charts"),
          links: charts.map((chart) => ({
            title: chart.title,
            subtitle: chart.description,
            page: `chart:${chart.id}:${encodeURIComponent(chart.period)}`,
          })),
        },
      ],
    };
  }
  if (page === "me") {
    const creator = await profile();
    return {
      title: creator.nick || load().name || t("QQ Music"),
      imageUrl: creator.headpic || load().imageUrl || undefined,
      sections: [],
    };
  }
  if (String(page).startsWith("chart:")) {
    const [, id, period] = String(page).split(":");
    const chart = { id: Number(id), period: decodeURIComponent(period || "") };
    const tracks = await chartTracks(chart, 100);
    const known = (await chartIndex().catch(() => [])).find((item) => String(item.id) === String(chart.id));
    return {
      title: known?.title || t("Charts"),
      description: known?.description || "",
      sections: [{ title: known?.title || t("Charts"), tracks }],
    };
  }
  problem("unsupported", "That page isn't available");
}

const SEARCH = {
  tracks: { type: 0, place: "txt.newclient.top", list: "song" },
  artists: { type: 1, place: "sizer.newclient.singer", list: "singer" },
  albums: { type: 2, place: "sizer.newclient.album", list: "album" },
  playlists: { type: 3, place: "sizer.newclient.playlist", list: "songlist" },
};

export async function search({ query, kind, offset }) {
  const spec = SEARCH[kind];
  if (!spec || !query) return { more: false };
  const page = Math.floor(Number(offset || 0) / 20) + 1;
  if (kind === "tracks") {
    const json = await cgi(
      `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${encodeURIComponent(query)}&p=${page}&n=20&format=json`,
    );
    const song = json.data?.song || {};
    const tracks = tracksFrom(song.list);
    return { tracks, more: page * 20 < Number(song.totalnum || 0) };
  }
  const data = await musicu(
    "music.search.SearchCgiService",
    "DoSearchForQQMusicDesktop",
    {
      query,
      search_type: spec.type,
      num_per_page: 20,
      page_num: page,
      remoteplace: spec.place,
      searchid: guid() + "00000",
      grp: 1,
    },
    "desktop",
  );
  const bucket = data?.body?.[spec.list] || {};
  const list = bucket.list || [];
  const more = Number(data?.meta?.nextpage || 0) > 0 || list.length === 20;
  if (kind === "artists") return { artists: list.map(toArtist).filter(Boolean), more };
  if (kind === "albums") return { albums: list.map(toAlbum).filter(Boolean), more };
  return {
    playlists: list
      .map((item) =>
        toPlaylistBrief({
          id: playlistId("diss", 0, item.dissid),
          name: item.dissname,
          imageUrl: item.imgurl,
          trackCount: item.song_count,
        }),
      )
      .filter(Boolean),
    more,
  };
}

export async function suggest({ query }) {
  if (!query) return [];
  const json = await cgi(`https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?key=${encodeURIComponent(query)}&format=json`);
  const names = [];
  for (const group of ["song", "singer", "album"]) {
    for (const item of json.data?.[group]?.itemlist || []) {
      if (item.name && !names.includes(item.name)) names.push(item.name);
    }
  }
  return names.slice(0, 10);
}

export async function recent() {
  if (!loggedIn()) return [];
  const data = await musicu(
    "music.musicasset.PlayRecentlyRead",
    "GetPlayRecentlyInfo",
    { requestCnt: 100, type: 2, updateTime: 0 },
    "private",
  );
  if (data?.code != null && data.code !== 0) return [];
  return tracksFrom((data?.data?.songList || data?.songList || []).map((item) => item.track || item));
}

export async function played({ id }) {
  if (!loggedIn() || !id) return;
  try {
    const songId = await songIdOf(id);
    radarSeeds.unshift(songId);
    radarSeeds.splice(8);
    await musicu(
      "music.musicasset.PlayRecentlyWrite",
      "ReportPlayRecentlyInfo",
      { data: [{ id: String(songId), lastTime: Math.floor(Date.now() / 1000), listenCnt: 1, type: 2 }] },
      "private",
    );
  } catch (error) {
    console.error(error);
  }
}

async function favorite() {
  const lists = await myLists();
  return lists.find((item) => item.fixed) || null;
}

export async function liked({ offset = 0 } = {}) {
  const fav = await favorite();
  if (!fav) return { tracks: [], more: false };
  const page = await diss(fav.tid, Number(offset) || 0, 50);
  return { tracks: page.tracks, more: page.more };
}

export async function isLiked({ ids }) {
  requireLogin();
  if (!likedCache) {
    const fav = await favorite();
    const set = new Set();
    if (fav) {
      const page = await diss(fav.tid, 0, 1000);
      for (const track of page.tracks) set.add(track.id);
    }
    likedCache = set;
  }
  const out = {};
  for (const id of ids || []) out[id] = likedCache.has(String(id));
  return out;
}

async function writeSongs(method, dirId, tid, name, songIds) {
  const data = await musicu(
    "music.musicasset.PlaylistDetailWrite",
    method,
    {
      dirId,
      bFmtUtf8: true,
      dirName: name,
      tid,
      v_songInfo: songIds.map((songId) => ({ songId, songType: 0 })),
    },
    "private",
  );
  if (data?.retCode !== 0) throw new Error(t("Could not reach QQ Music"));
}

export async function like({ id, on }) {
  requireLogin();
  const fav = await favorite();
  if (!fav) problem("unavailable", "Could not reach QQ Music");
  const songId = await songIdOf(id);
  await writeSongs(on ? "AddSonglist" : "DelSonglist", fav.dirId, fav.tid, fav.name, [songId]);
  if (likedCache) {
    if (on) likedCache.add(String(id));
    else likedCache.delete(String(id));
  }
}

export async function album({ id }) {
  const [detail, listed] = await Promise.all([
    musicu("music.musichallAlbum.AlbumInfoServer", "GetAlbumDetail", { albumMid: String(id) }),
    musicu("music.musichallAlbum.AlbumSongList", "GetAlbumSongList", { albumMid: String(id), begin: 0, num: 100, order: 2 }),
  ]);
  const info = detail?.basicInfo || {};
  return {
    album: toAlbum({ albumMid: info.albumMid || id, albumName: info.albumName, singerName: info.singer?.singerList?.[0]?.name }),
    tracks: tracksFrom(listed?.songList),
  };
}

export async function artist({ id }) {
  const [detail, listed, albums] = await Promise.all([
    musicu("music.musichallSinger.SingerInfoInter", "GetSingerDetail", {
      singer_mids: [String(id)],
      pic: 1,
      group_singer: 1,
      wiki_singer: 1,
      ex_singer: 1,
    }),
    musicu("music.musichallSong.SongListInter", "GetSingerSongList", { singerMid: String(id), begin: 0, num: 30, order: 1 }),
    musicu("music.musichallAlbum.AlbumListServer", "GetAlbumList", { singerMid: String(id), order: 1, num: 12, begin: 0 }),
  ]);
  const singer = detail?.singer_list?.[0] || { singerMID: id };
  return {
    artist: toArtist(singer),
    tracks: tracksFrom(listed?.songList),
    albums: (albums?.albumList || []).map(toAlbum).filter(Boolean),
  };
}

export async function playlists() {
  const lists = await myLists();
  return lists
    .map((item) =>
      toPlaylistBrief(
        { id: playlistId(item.mine ? "mine" : "diss", item.dirId, item.tid), name: item.name, imageUrl: item.imageUrl, trackCount: item.trackCount },
        { mine: item.mine, fixed: item.fixed },
      ),
    )
    .filter(Boolean);
}

export async function playlist({ id }) {
  const parsed = parsePlaylistId(id);
  const owned = (libraryCache || []).find((item) => item.tid === parsed.tid && item.mine === parsed.mine);
  const page = await diss(parsed.tid, 0, 1000);
  const mapped = toPlaylistBrief(
    { id, name: owned?.name || page.name || "Playlist", description: page.description, imageUrl: owned?.imageUrl || page.imageUrl, trackCount: page.trackCount },
    { mine: parsed.mine, fixed: owned?.fixed },
  );
  mapped.tracks = page.tracks;
  return mapped;
}

export async function createPlaylist({ name }) {
  requireLogin();
  const data = await musicu(
    "music.musicasset.PlaylistBaseWrite",
    "AddPlaylist",
    { bFmtUtf8: true, dirName: name },
    "private",
  );
  if (data?.retCode !== 0 || !data?.result?.dirId) throw new Error(t("Could not reach QQ Music"));
  invalidateLibrary();
  return toPlaylistBrief(
    { id: playlistId("mine", data.result.dirId, data.result.tid), name },
    { mine: true, fixed: false },
  );
}

function ownedOrThrow(id) {
  const parsed = parsePlaylistId(id);
  if (!parsed.mine || !parsed.dirId) problem("unsupported", "That page isn't available");
  if (parsed.dirId === LIKED_DIR) problem("unsupported", "That playlist is kept by QQ Music");
  return parsed;
}

export async function renamePlaylist({ id, name }) {
  requireLogin();
  const parsed = ownedOrThrow(id);
  const data = await musicu(
    "music.musicasset.PlaylistBaseWrite",
    "EditPlaylist",
    { bFmtUtf8: true, dirId: parsed.dirId, dirNewName: name, dirShow: 1, mask: 1 },
    "private",
  );
  if (data?.retCode !== 0) throw new Error(t("Could not reach QQ Music"));
  invalidateLibrary();
}

export async function deletePlaylist({ id }) {
  requireLogin();
  const parsed = ownedOrThrow(id);
  const owned = (await myLists()).find((item) => item.dirId === parsed.dirId);
  const data = await musicu(
    "music.musicasset.PlaylistBaseWrite",
    "DelPlaylist",
    { bFmtUtf8: true, dirId: parsed.dirId, dirName: owned?.name || "" },
    "private",
  );
  if (data?.retCode !== 0) throw new Error(t("Could not reach QQ Music"));
  invalidateLibrary();
}

async function songIdsOf(trackIds) {
  const ids = [];
  for (const trackId of trackIds || []) ids.push(await songIdOf(trackId));
  return ids;
}

export async function addToPlaylist({ id, trackIds }) {
  requireLogin();
  const parsed = parsePlaylistId(id);
  const owned = (await myLists()).find((item) => item.mine && item.tid === parsed.tid);
  if (!owned) problem("unsupported", "That page isn't available");
  await writeSongs("AddSonglist", owned.dirId, owned.tid, owned.name, await songIdsOf(trackIds));
}

export async function removeFromPlaylist({ id, trackIds }) {
  requireLogin();
  const parsed = parsePlaylistId(id);
  const owned = (await myLists()).find((item) => item.mine && item.tid === parsed.tid);
  if (!owned) problem("unsupported", "That page isn't available");
  await writeSongs("DelSonglist", owned.dirId, owned.tid, owned.name, await songIdsOf(trackIds));
}

export async function stations() {
  return [
    { id: "radio:99", name: t("Guess You Like"), description: t("Songs picked for you") },
    { id: "radar", name: t("Radar"), description: t("Songs like what you just played") },
  ];
}

export async function stationNext({ id }) {
  if (String(id) === "radar") {
    const page = (stationPages.get(id) || 0) + 1;
    stationPages.set(id, page);
    let seeds = radarSeeds.slice(0, 5);
    if (!seeds.length) {
      const fresh = await newSongs().catch(() => []);
      const known = songs().get(fresh[0]?.id);
      if (known?.id) seeds = [Number(known.id)];
    }
    const data = await musicu("music.recommend.TrackRelationServer", "GetRadarSong", {
      Page: page,
      ReqType: 0,
      FavSongs: [],
      EntranceSongs: seeds,
    });
    return tracksFrom((data?.VecSongs || []).map((item) => item.Track || item));
  }
  const radioId = String(id).startsWith("radio:") ? Number(String(id).slice(6)) : 99;
  const data = await musicu("music.radioProxy.MbTrackRadioSvr", "get_radio_track", {
    id: radioId,
    num: 5,
    from: 0,
    scene: 0,
    song_ids: [],
  });
  return tracksFrom(data?.tracks);
}

export async function lyrics({ id }) {
  let lyric = "";
  let translation = "";
  try {
    const data = await musicu("music.musichallSong.PlayLyricInfo", "GetPlayLyricInfo", {
      songMID: String(id),
      songID: 0,
      trans: 1,
      roma: 0,
      crypt: 0,
      qrc: 0,
    });
    lyric = lyricText(data?.lyric);
    translation = lyricText(data?.trans);
  } catch {
    lyric = "";
  }
  if (!lyric) {
    const json = await cgi(
      `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(id)}&format=json&nobase64=1`,
    );
    lyric = lyricText(json.lyric);
    translation = lyricText(json.trans);
  }
  if (translation) return { lrc: lyric, translation };
  const lines = parseLrc(lyric);
  if (!lines.length) return { lrc: lyric, translation: "" };
  return { lines };
}

export async function stream({ id, quality }) {
  const media = songs().get(String(id))?.media || String(id);
  for (const spec of chainFor(quality)) {
    const filename = `${spec.prefix}${media}${media}.${spec.ext}`;
    const data = await musicu("music.vkey.GetVkey", "UrlGetVkey", {
      guid: guid(),
      songmid: [String(id)],
      songtype: [0],
      uin: load().musicid || "0",
      loginflag: 1,
      platform: "20",
      filename: [filename],
    });
    const info = data?.midurlinfo?.[0];
    if (info?.purl && (info.result == null || info.result === 0)) {
      return {
        url: joinStream(data.sip, info.purl),
        type: spec.type,
        headers: { referer: "https://y.qq.com/", "user-agent": UA },
      };
    }
  }
  problem("unavailable", "This song can't be played");
}
