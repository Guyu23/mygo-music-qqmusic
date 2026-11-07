# QQ音乐 · MyGo Music

给 [MyGo Music](https://github.com/egoist/mygo-music) 用的 QQ 音乐插件。非官方，与腾讯、QQ 音乐没有关联。

用 QQ 扫码登录。登录态只留在这台电脑的插件数据里，设置里没有 Cookie 栏。

安装（需要 MyGo Music 0.1.8 或更新）：

[mygo-music://install-plugin?repo=Guyu23/mygo-music-qqmusic](mygo-music://install-plugin?repo=Guyu23/mygo-music-qqmusic)

也可以在 设置 → 插件 里粘贴：

```
https://github.com/Guyu23/mygo-music-qqmusic
```

## 能做什么

- QQ 扫码登录、退出
- 我的歌单（我喜欢、自建）和收藏的歌单，以及公开歌单
- 为你推荐、新歌、推荐歌单、排行榜
- 听歌模式：猜你喜欢、雷达（登录后取歌）
- 歌词
- 播放历史（登录后读取，开始播放时记一笔）
- 搜索歌曲、专辑、歌手和歌单

会员和版权以 QQ 音乐账号为准。接口只给普通音频地址时才播放。加密格式（mflac、nac 这类）不会在本地解密，这种歌会显示暂时不能播放。

## 开发

```bash
node --test
```

`test/plugin.test.mjs` 用假接口核对登录、歌单、推荐、听歌模式、歌词和播放地址。`test/live.test.mjs` 会访问 QQ 音乐的公开接口。
