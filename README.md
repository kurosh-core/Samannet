# Config Cloud Panel

پلتفرم SaaS چند-مستأجری (Multi-Tenant) برای مدیریت کانفیگ‌های شبکه (VLESS, VMess, Trojan,
Shadowsocks, WireGuard)، اتصال امن به Cloudflare، سیستم Subscription و پنل ادمین.

---

## اجرای سریع (فقط با Docker)

پیش‌نیاز: [Docker](https://www.docker.com/products/docker-desktop/) و Docker Compose نصب باشد.

```bash
# 1) وارد پوشه پروژه شوید
cd config-cloud-panel

# 2) فایل env بسازید
cp .env.example .env

# 3) دو مقدار امنیتی زیر را در .env بسازید و جایگزین کنید:
openssl rand -base64 32   # -> برای ENCRYPTION_KEY
openssl rand -hex 32      # -> برای SESSION_SECRET

# 4) اجرا
docker compose up --build
```

بعد از چند ثانیه، مرورگر را باز کنید:

```
http://localhost:3000
```

ثبت‌نام کنید؛ به‌صورت خودکار یک Workspace اختصاصی برای شما ساخته می‌شود.

> اگر `openssl` ندارید (مثلا در ویندوز)، می‌توانید هر رشته‌ی تصادفی ۳۲+ کاراکتری برای
> `SESSION_SECRET` و یک رشته‌ی Base64 دقیقا ۳۲ بایتی برای `ENCRYPTION_KEY` قرار دهید؛
> در PowerShell:
> ```powershell
> [Convert]::ToBase64String((1..32 | %{Get-Random -Max 256}))
> ```

---

## ساخت کاربر ادمین

ثبت‌نام‌های عادی همیشه نقش `USER` می‌گیرند. برای تبدیل یک کاربر به ADMIN (دسترسی به `/admin`):

```bash
docker compose exec backend node scripts/make-admin.js you@example.com
```

سپس دوباره وارد شوید و از `/admin` استفاده کنید.

---

## ساختار پوشه‌ها

```
config-cloud-panel/
├── docker-compose.yml
├── .env.example
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── prisma/
│   │   ├── schema.prisma        # همه مدل‌های دیتابیس (PostgreSQL)
│   │   └── seed.js              # Planهای پیش‌فرض: Free/Basic/Pro/Business
│   ├── scripts/
│   │   └── make-admin.js
│   └── src/
│       ├── index.js             # نقطه ورود Express
│       ├── db.js                # Prisma Client
│       ├── middleware/
│       │   ├── auth.js          # Session/JWT + httpOnly cookie
│       │   ├── workspace.js     # ایزوله‌سازی Multi-Tenant (ضد IDOR)
│       │   └── rateLimit.js
│       ├── protocols/           # معماری Protocol Adapter
│       │   ├── ProtocolAdapter.js   # اینترفیس پایه: validate/generate/parse/normalize
│       │   ├── vless.js
│       │   ├── vmess.js
│       │   ├── trojan.js
│       │   ├── shadowsocks.js
│       │   ├── wireguard.js
│       │   └── index.js         # رجیستری مرکزی پروتکل‌ها
│       ├── routes/
│       │   ├── auth.js
│       │   ├── configs.js
│       │   ├── users.js         # ConfigUser (کاربران مصرف‌کننده)
│       │   ├── subscriptions.js # شامل مسیر عمومی /sub/:token
│       │   ├── statistics.js
│       │   ├── cloudflare.js    # OAuth یا اتصال با API Token
│       │   └── admin.js
│       ├── lib/
│       │   ├── crypto.js        # رمزنگاری AES-256-GCM برای Secretها
│       │   ├── audit.js
│       │   └── expiryJob.js     # Cron هر ۵ دقیقه: انقضا و محدودیت ترافیک
│       └── public/               # فرانت‌اند (SPA سبک، بدون build step)
│           ├── login.html / register.html / dashboard.html / admin.html
│           ├── css/style.css
│           └── js/{api,app,admin}.js
```

## افزودن پروتکل جدید

بدون تغییر در بقیه پروژه:

1. یک فایل جدید در `backend/src/protocols/` بسازید (مثلا `hysteria2.js`) که کلاس
   `ProtocolAdapter` را extend کند و متدهای `validate / generate / parse / normalize`
   و آرایه `fields` (برای رندر داینامیک فرم در فرانت‌اند) را پیاده‌سازی کند.
2. آن را در `backend/src/protocols/index.js` به آبجکت `registry` اضافه کنید.
3. مقدار جدید را به `enum Protocol` در `prisma/schema.prisma` اضافه کرده و
   `docker compose exec backend npx prisma db push` را اجرا کنید.

## نکات امنیتی پیاده‌سازی‌شده

- رمزهای عبور با bcrypt (cost=12) هش می‌شوند.
- Session با httpOnly + Secure (در production) + SameSite=Lax کوکی نگه‌داری می‌شود.
- Cloudflare API Token با AES-256-GCM رمزنگاری و فقط سمت سرور رمزگشایی می‌شود؛ هرگز به
  Client بازگردانده نمی‌شود و در هیچ Log یا پیام خطایی چاپ نمی‌شود.
- هر Request به Config/User/Subscription، مالکیت Workspace را چک می‌کند (جلوگیری از IDOR).
- Rate Limiting روی Login/Register/Cloudflare/Subscription Generation/Admin API.
- Audit Log برای رویدادهای حساس (بدون ذخیره Password/Token/Private Key).
- Private Key در WireGuard هرگز Log نمی‌شود.
- Error Handler سراسری هرگز Stack Trace یا Secret را به کاربر نمایش نمی‌دهد.

## محدودیت‌های شناخته‌شده این نسخه

- Cloudflare OAuth فقط زمانی فعال می‌شود که `CLOUDFLARE_CLIENT_ID` و
  `CLOUDFLARE_CLIENT_SECRET` (از یک اپ ثبت‌شده در Cloudflare) در `.env` تنظیم شده باشند؛
  در غیر این صورت اتصال با API Token (که خودِ سند اصلی هم به‌عنوان Fallback مجاز دانسته) استفاده می‌شود.
- شمارش واقعی Upload/Download ترافیک نیازمند اتصال به یک سرور Xray/WireGuard واقعی
  (خارج از این پنل) است که آمار مصرف را به Endpoint داخلی این پنل گزارش دهد؛ این پنل
  مدل داده و منطق اعمال محدودیت/انقضا را کامل پیاده‌سازی کرده، اما خودِ Agent جمع‌آوری
  ترافیک از سرورهای واقعی خارج از دامنه‌ی این تحویل است.
- SOCKS5 و HTTP Proxy در `enum Protocol` تعریف شده‌اند اما Adapter اختصاصی هنوز ندارند؛
  طبق همان معماری Adapter به‌سادگی قابل افزودن است.

## توسعه لوکال بدون Docker (اختیاری)

```bash
cd backend
npm install
npx prisma generate
npx prisma db push
node prisma/seed.js
node src/index.js
```
(نیازمند یک PostgreSQL در حال اجرا مطابق `DATABASE_URL` در `.env`)
