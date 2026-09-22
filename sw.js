// Service Worker：让应用可安装、能离线打开，并提供系统通知通道。
// 只接管本站资源；发往 api.deepseek.com 的请求原样放行，不缓存、不拦截。

const CACHE = 'dsb-v10';

// 只有这几个静态资源进缓存。其余的一律直接交给网络——
// 这一点很关键：版本清单和安装包必须每次都取新的，一旦被缓存住，
// 上传新版本后用户永远看不到更新提示，点下载还可能拿到旧安装包。
// 之前这里是「除导航外全部缓存优先」，就是那个 bug 的来源。
const ASSETS = [
  './deepseek-balance.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];
// 用「相对作用域的路径」而不是文件名来匹配，因为图标在 icons/ 子目录下
const CACHEABLE = new Set(ASSETS.map((p) => p.slice(2)));

// SW 脚本自身所在的目录，也就是作用域。用 self.location 而不是
// self.registration.scope，后者在脚本求值阶段未必已经就绪。
const BASE = self.location.pathname.replace(/[^/]*$/, '');

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {})
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    // 只清理本应用自己的旧缓存。部署地址 kaokaoyuba.github.io 被该用户
    // 所有 GitHub Pages 项目共享，无差别删除会把别人的离线缓存一起干掉。
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('dsb-') && k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  // 跨域（也就是 DeepSeek 的接口）直接交给浏览器，不走缓存
  if (url.origin !== self.location.origin) return;

  // 页面本身用「网络优先」：保证更新后立刻看到新版，断网时回退到缓存
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./deepseek-balance.html')))
    );
    return;
  }

  // 白名单之外的（版本清单、APK 等）不拦截也不缓存，原样走网络。
  // 返回而不调用 respondWith，浏览器就按它自己的方式处理这个请求。
  if (!url.pathname.startsWith(BASE)) return;
  if (!CACHEABLE.has(url.pathname.slice(BASE.length))) return;

  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});

// 点击通知时聚焦（或打开）应用窗口
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./deepseek-balance.html');
    })
  );
});
