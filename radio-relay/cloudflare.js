// ============================================================
// Radio Relay Worker (بهبود یافته)
// ============================================================
// تغییرات نسبت به نسخه اولیه:
//  1) allow-list فعال برای دامنه‌های مجاز (جلوگیری از open proxy عمومی)
//  2) چک اختیاری Referer/Origin (پیش‌فرض خاموش، پایین توضیح داده شده)
//  3) اعتبارسنجی URL ورودی (فقط http/https)
//  4) هندل کردن OPTIONS برای CORS preflight
//  5) Timeout با AbortController
//  6) پیام خطای واضح‌تر برای سرور مقصد
//  7) پاس دادن هدرهای پاسخ مربوط به Icecast/Shoutcast (icy-name, icy-genre, ...)
//     نکته: هدر Range از کلاینت عمداً رله نمی‌شه چون بعضی سرورهای شوتکست با
//     دیدنش 403 می‌دن (این مشکل رو با GLwiz تجربه کردیم).
// ============================================================

// فقط این دامنه‌ها قابل رله‌ان (بر اساس لینک‌هایی که توی index.html استفاده کردید).
// هر دامنه جدیدی که بعداً رله کردید، اینجا هم اضافه‌ش کنید وگرنه 403 می‌گیرید.
const ALLOWED_HOSTS = [
  "audiostr.atv.az",
  "icecast.livetv.az",
  "shoutcast.glwiz.com",
];

// اختیاری: اگه true باشه، Worker فقط درخواست‌هایی رو قبول می‌کنه که Referer/Origin‌شون
// یکی از دامنه‌های ALLOWED_REFERER_HOSTS باشه (یعنی از صفحه‌ی رادیوی خودتون بیاد).
// این جلوی embed شدن لینک‌های رله‌شده توی سایت/اپ دیگه‌ای رو می‌گیره.
// پیش‌فرض false گذاشتمش چون:
//  - وقتی خودتون مستقیم لینک رو توی مرورگر باز می‌کنید (بدون از صفحه رادیو اومدن)، Referer نداره و رد می‌شه
//  - بعضی پلیرهای موبایل/اپ‌ها هم Referer نمی‌فرستن
// اگه فقط از همون صفحه‌ی رادیو استفاده می‌کنید و تست دستی لازم ندارید، بذاریدش true.
const REQUIRE_REFERER = false;
const ALLOWED_REFERER_HOSTS = ["hamedcode.github.io"];

const FETCH_TIMEOUT_MS = 10000; // 10 ثانیه برای اتصال اولیه

const INDEX_HTML = `
<!DOCTYPE html>
<html lang="fa">
<head>
<meta charset="UTF-8" />
<title>Radio Relay</title>
<style>
    body {
      margin: 0;
      height: 100vh;
      background: #000;
      color: white;
      font-family: sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    .box {
      background: #111;
      border: 1px solid #333;
      padding: 25px;
      width: 330px;
      border-radius: 12px;
      text-align: center;
      box-shadow: 0 0 15px #000;
    }
    input {
      width: calc(100% - 20px);
      padding: 12px;
      margin: 12px 0;
      direction: ltr;
      border-radius: 6px;
      border: 1px solid #555;
      background: #222;
      color: white;
    }
    button {
      width: 100%;
      padding: 12px;
      font-size: 16px;
      background: #444;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
    }
    a {
        display: block;
        margin-top: 15px;
        font-size: 15px;
        color: Yellow;
    }
    .err {
        color: #ff6b6b;
        font-size: 13px;
        margin-top: 8px;
    }
</style>
</head>
<body>

<div class="box">
    <h3>Radio Relay</h3>

    <!-- لینک رادیوی ثابت شما -->
    <a href="https://hamedcode.github.io/radio/" target="_blank">
        ▶  My Radio 
    </a>

    <hr>

    <p>باشد Allow hosts حتما باید در لیست</p>
    <p>:رله کردن یک آدرس جدید</p>
    <input id="url" placeholder="https://example.com/stream.mp3" />

    <button onclick="go()">GO</button>
    <div id="err" class="err"></div>
</div>

<script>
function go() {
    const u = document.getElementById('url').value.trim();
    const errBox = document.getElementById('err');
    errBox.textContent = "";
    if (!u) { errBox.textContent = "لطفاً URL وارد کنید"; return; }
    try {
      const parsed = new URL(u);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        errBox.textContent = "فقط آدرس‌های http یا https مجازند";
        return;
      }
    } catch {
      errBox.textContent = "آدرس وارد شده معتبر نیست";
      return;
    }
    window.location.href = "/?url=" + encodeURIComponent(u);
}
</script>

</body>
</html>
`;

function isHostAllowed(hostname) {
  if (ALLOWED_HOSTS.length === 0) return true;
  return ALLOWED_HOSTS.some(
    (h) => hostname === h || hostname.endsWith("." + h)
  );
}

function isRefererAllowed(request) {
  const ref = request.headers.get("Referer") || request.headers.get("Origin");
  if (!ref) return false;
  try {
    const refHost = new URL(ref).hostname;
    return ALLOWED_REFERER_HOSTS.some(
      (h) => refHost === h || refHost.endsWith("." + h)
    );
  } catch {
    return false;
  }
}

// هدرهایی که از درخواست ورودی به مقصد پاس داده می‌شن
// نکته: بعضی سرورهای Shoutcast/Icecast قدیمی با دیدن هدر Range یا Icy-MetaData
// ریکوئست رو با 403 رد می‌کنن. به همین دلیل این‌ها پیش‌فرض خاموش‌ان.
// اگه سرور مقصدتون این هدرها رو مشکلی نداشت، می‌تونید به آرایه زیر اضافه‌شون کنید.
const FORWARD_REQUEST_HEADERS = [];

// هدرهایی که از پاسخ مقصد به کلاینت پاس داده می‌شن
const FORWARD_RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
  "icy-name",
  "icy-genre",
  "icy-br",
  "icy-description",
  "icy-url",
];

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Icy-MetaData",
  };
}

export default {
  async fetch(request) {
    const { searchParams } = new URL(request.url);
    const target = searchParams.get("url");

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // صفحه اول - بدون پارامتر url
    if (!target) {
      return new Response(INDEX_HTML, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // اعتبارسنجی URL
    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      return new Response("Invalid URL", { status: 400 });
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return new Response("Only http/https URLs are allowed", { status: 400 });
    }
    if (!isHostAllowed(parsed.hostname)) {
      return new Response("This host is not on the allow-list", { status: 403 });
    }
    if (REQUIRE_REFERER && !isRefererAllowed(request)) {
      return new Response("Forbidden: bad referer/origin", { status: 403 });
    }

    // هدرهای ورودی مجاز رو به درخواست مقصد پاس بده
    const forwardHeaders = new Headers({ "User-Agent": "Mozilla/5.0" });
    for (const h of FORWARD_REQUEST_HEADERS) {
      const v = request.headers.get(h);
      if (v) forwardHeaders.set(h, v);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(parsed.toString(), {
        headers: forwardHeaders,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok && response.status !== 206) {
        return new Response(
          `Upstream error: ${response.status} ${response.statusText}`,
          { status: response.status >= 400 ? response.status : 502 }
        );
      }

      const headers = new Headers(corsHeaders());
      for (const h of FORWARD_RESPONSE_HEADERS) {
        const v = response.headers.get(h);
        if (v) headers.set(h, v);
      }
      if (!headers.has("content-type")) {
        headers.set("content-type", "audio/mpeg");
      }
      headers.set("Cache-Control", "no-store");

      return new Response(response.body, {
        status: response.status,
        headers,
      });
    } catch (e) {
      clearTimeout(timeoutId);
      if (e.name === "AbortError") {
        return new Response("Relay error: upstream timeout", { status: 504 });
      }
      return new Response("Relay error: " + e.toString(), { status: 500 });
    }
  },
};
