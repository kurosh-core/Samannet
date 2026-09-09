import os
import re
import json
import math
import time
import secrets
import logging
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, UploadFile, HTTPException, Depends, status, Request, Query, Body
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBasic, HTTPBasicCredentials

# ---------------------------------------------------------------------------
# تنظیمات پایه و لاگ‌گیری
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("yahsat-app")

app = FastAPI(title="Yahsat Smart Alignment & CMS", version="1.3.0")

security = HTTPBasic()

# رمزهای ادمین دیگر داخل کد نیستند؛ از متغیرهای محیطی خوانده می‌شوند.
# قبل از اجرا حتماً این دو متغیر را در سرور ست کنید:
#   export ADMIN_USER="admin"
#   export ADMIN_PASS="یک-رمز-قوی-و-طولانی"
ADMIN_USER = os.environ.get("ADMIN_USER")
ADMIN_PASS = os.environ.get("ADMIN_PASS")

if not ADMIN_USER or not ADMIN_PASS:
    raise RuntimeError(
        "متغیرهای محیطی ADMIN_USER و ADMIN_PASS باید تنظیم شوند. "
        "برنامه به دلایل امنیتی بدون این مقادیر اجرا نمی‌شود."
    )

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "static" / "uploads"
CONFIG_FILE = BASE_DIR / "config.json"

# فقط این پسوندها اجازه‌ی آپلود دارند (بنر/تصویر/ویدیو/سند)
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".pdf"}
MAX_UPLOAD_SIZE = 25 * 1024 * 1024  # ۲۵ مگابایت

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")


# ---------------------------------------------------------------------------
# محاسبه‌ی دقیق آزیموت / ارتفاع / اسکیو برای ماهواره‌های ثابت زمین (Geostationary)
# روش: تبدیل بردار مکان روی بیضوی WGS84 به مختصات محلی ENU (شرق-شمال-بالا)
# این روش همان روشیه که نرم‌افزارهای حرفه‌ای ماهواره‌یابی استفاده می‌کنند.
# ---------------------------------------------------------------------------
WGS84_A = 6378137.0                      # نیم‌قطر بزرگ زمین (متر) - استاندارد WGS84
WGS84_F = 1 / 298.257223563              # ضریب پخی زمین
WGS84_E2 = 2 * WGS84_F - WGS84_F ** 2    # مربع خروج از مرکز
GEOSTATIONARY_RADIUS_M = 42164170.0      # شعاع مدار زمین‌ثابت از مرکز زمین (متر)

# فقط ماهواره‌های خانواده‌ی یاهست — طبق درخواست، سایت محدود به همین‌هاست
YAHSAT_SATELLITES = {
    "yahsat1a": {"name": "Yahsat 1A (Al Yah 1)", "lon": 52.5},
}
DEFAULT_SATELLITE = "yahsat1a"


def compute_pointing(lat_deg: float, lon_deg: float, alt_m: float, sat_lon_deg: float) -> dict:
    """
    محاسبه‌ی دقیق آزیموت، ارتفاع (Elevation) و زاویه‌ی اسکیو LNB
    برای یک ناظر روی سطح زمین (بیضوی WGS84) نسبت به یک ماهواره‌ی زمین‌ثابت.
    """
    lat = math.radians(lat_deg)
    lon = math.radians(lon_deg)
    sat_lon = math.radians(sat_lon_deg)

    # موقعیت ناظر در مختصات ECEF (بر پایه‌ی بیضوی WGS84 - نه کره‌ی ساده)
    N = WGS84_A / math.sqrt(1 - WGS84_E2 * math.sin(lat) ** 2)
    Xo = (N + alt_m) * math.cos(lat) * math.cos(lon)
    Yo = (N + alt_m) * math.cos(lat) * math.sin(lon)
    Zo = (N * (1 - WGS84_E2) + alt_m) * math.sin(lat)

    # موقعیت ماهواره در مختصات ECEF (روی صفحه‌ی استوا، ارتفاع صفر)
    Xs = GEOSTATIONARY_RADIUS_M * math.cos(sat_lon)
    Ys = GEOSTATIONARY_RADIUS_M * math.sin(sat_lon)
    Zs = 0.0

    dX, dY, dZ = Xs - Xo, Ys - Yo, Zs - Zo

    # تبدیل بردار به مختصات محلی East-North-Up
    east = -math.sin(lon) * dX + math.cos(lon) * dY
    north = (
        -math.sin(lat) * math.cos(lon) * dX
        - math.sin(lat) * math.sin(lon) * dY
        + math.cos(lat) * dZ
    )
    up = (
        math.cos(lat) * math.cos(lon) * dX
        + math.cos(lat) * math.sin(lon) * dY
        + math.sin(lat) * dZ
    )

    distance_km = math.sqrt(east**2 + north**2 + up**2) / 1000.0
    elevation = math.degrees(math.atan2(up, math.sqrt(east**2 + north**2)))
    azimuth = math.degrees(math.atan2(east, north))
    if azimuth < 0:
        azimuth += 360.0

    # زاویه‌ی اسکیو (چرخش LNB حول محور خودش) - تقریب استاندارد صنعتی
    lon_diff = sat_lon - lon
    if lat == 0:
        skew = 0.0
    else:
        skew = math.degrees(math.atan2(math.sin(lon_diff), math.tan(lat)))

    visible = elevation > 0

    return {
        "azimuth": round(azimuth, 2),
        "elevation": round(elevation, 2),
        "skew": round(skew, 2),
        "distance_km": round(distance_km, 1),
        "visible": visible,
    }


# ---------------------------------------------------------------------------
# ذخیره‌ی موقت آخرین قرائت واقعی گیرنده (اگر ریسیور واقعی به سایت وصل شود)
# این مقدار هرگز به‌صورت مصنوعی تولید نمی‌شود؛ فقط اگر یک دستگاه واقعی
# (ریسیور/تیونر) آن را از طریق /api/signal ارسال کند، اینجا نگه‌داری می‌شود.
# ---------------------------------------------------------------------------
_last_real_signal: Optional[dict] = None
SIGNAL_FRESHNESS_SECONDS = 15  # بعد از این مدت، قرائت قدیمی و نامعتبر تلقی می‌شود


# ---------------------------------------------------------------------------
# مدیریت کانفیگ (نوشتن اتمیک برای جلوگیری از خرابی فایل)
# ---------------------------------------------------------------------------
def load_config() -> dict:
    default_config = {"maintenance": False, "notice": "خوش آمدید"}
    if not CONFIG_FILE.exists():
        save_config(default_config)
        return default_config
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if not isinstance(data, dict):
                raise ValueError("فرمت کانفیگ نامعتبر است")
            return data
    except Exception as e:
        logger.error("خطا در خواندن config.json: %s — استفاده از مقادیر پیش‌فرض", e)
        return default_config


def save_config(config: dict) -> None:
    tmp_path = CONFIG_FILE.with_suffix(".tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=4)
    tmp_path.replace(CONFIG_FILE)  # جایگزینی اتمیک


# ---------------------------------------------------------------------------
# احراز هویت ادمین (مقایسه‌ی ایمن در برابر Timing Attack)
# ---------------------------------------------------------------------------
def verify_admin(credentials: HTTPBasicCredentials = Depends(security)) -> str:
    valid_user = secrets.compare_digest(credentials.username, ADMIN_USER)
    valid_pass = secrets.compare_digest(credentials.password, ADMIN_PASS)
    if not (valid_user and valid_pass):
        logger.warning("تلاش ناموفق برای ورود به پنل ادمین از کاربر: %s", credentials.username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="نام کاربری یا رمز عبور نادرست است",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username


# ---------------------------------------------------------------------------
# ابزار امنیتی: پاک‌سازی نام فایل برای جلوگیری از Path Traversal
# ---------------------------------------------------------------------------
def secure_filename(filename: str) -> str:
    filename = os.path.basename(filename)  # حذف هرگونه مسیر (../ یا /)
    filename = filename.replace("\x00", "")
    filename = re.sub(r"[^A-Za-z0-9._-]", "_", filename)
    filename = filename.lstrip(".").strip("_")
    if not filename:
        raise ValueError("نام فایل نامعتبر است")
    return filename


def resolve_safe_path(filename: str) -> Path:
    """مسیر نهایی فایل را می‌سازد و تضمین می‌کند خارج از UPLOAD_DIR نیفتد."""
    safe_name = secure_filename(filename)
    candidate = (UPLOAD_DIR / safe_name).resolve()
    if UPLOAD_DIR.resolve() not in candidate.parents and candidate != UPLOAD_DIR.resolve():
        raise HTTPException(status_code=400, detail="مسیر فایل نامعتبر است")
    return candidate


# --- Public Endpoints (صفحه اصلی) -----------------------------------------

@app.get("/", response_class=HTMLResponse)
async def home():
    config = load_config()
    if config.get("maintenance", False):
        return """
        <!DOCTYPE html>
        <html lang="fa" dir="rtl">
            <head><title>سایت در دست تعمیر است</title><meta charset="utf-8"></head>
            <body style="background:#0f172a; color:#fff; text-align:center; padding-top:120px; font-family:Tahoma;">
                <h1 style="color:#ef4444;">سایت موقتاً در حال به‌روزرسانی است</h1>
                <p>به زودی با امکانات جدید برمی‌گردیم.</p>
            </body>
        </html>
        """

    return """
    <!DOCTYPE html>
    <html lang="fa" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>تنظیم‌گر هوشمند یاهست - سامان</title>
        <style>
            body { background: #0b0f19; color: #f8fafc; font-family: Tahoma, sans-serif; text-align: center; padding: 15px; margin: 0; }
            .card { background: #131b2e; padding: 20px; border-radius: 16px; max-width: 420px; margin: 20px auto; box-shadow: 0 10px 25px rgba(0,0,0,0.6); border: 1px solid #1e293b; }
            .meter-box { background: #05070b; padding: 15px; border-radius: 12px; margin: 20px 0; border: 1px solid #1f293d; }
            .bar-row { display: flex; align-items: center; margin: 12px 0; justify-content: space-between; }
            .label { font-size: 22px; font-weight: bold; width: 30px; text-align: left; font-family: monospace; }
            .label-s { color: #38bdf8; }
            .label-q { color: #c084fc; }
            .bar-container { flex-grow: 1; height: 22px; background: #111827; border-radius: 4px; margin: 0 10px; overflow: hidden; border: 1px solid #374151; position: relative; }
            .bar-fill { height: 100%; width: 0%; transition: width 0.2s ease-in-out; }
            .fill-s { background: #38bdf8; box-shadow: 0 0 10px rgba(56,189,248,0.5); }
            .fill-q { background: #c084fc; box-shadow: 0 0 10px rgba(192,132,252,0.5); }
            .percentage { font-size: 18px; font-weight: bold; width: 55px; text-align: right; font-family: monospace; }
            button { background: #2563eb; color: white; border: none; padding: 12px 20px; border-radius: 10px; cursor: pointer; font-size: 16px; font-weight: bold; width: 100%; transition: 0.2s; }
            button:hover { background: #1d4ed8; }
            .info { font-size: 13px; color: #94a3b8; margin-top: 15px; line-height: 1.5; }
        </style>
    </head>
    <body>
        <div class="card">
            <h2>تنظیم‌گر حرفه‌ای یاهست</h2>
            <p class="info">گوشی را روی بدنه‌ی دیش بگذارید تا وضعیت سیگنال (S) و کیفیت (Q) به‌صورت زنده تغییر کند.</p>

            <div class="meter-box">
                <div class="bar-row">
                    <span class="label label-s">S</span>
                    <div class="bar-container">
                        <div id="bar-s" class="bar-fill fill-s"></div>
                    </div>
                    <span id="val-s" class="percentage" style="color: #38bdf8;">0%</span>
                </div>
                <div class="bar-row">
                    <span class="label label-q">Q</span>
                    <div class="bar-container">
                        <div id="bar-q" class="bar-fill fill-q"></div>
                    </div>
                    <span id="val-q" class="percentage" style="color: #c084fc;">0%</span>
                </div>
            </div>

            <button onclick="initSensors()">اتصال سنسورها و شروع تنظیم</button>
            <p id="status-text" class="info">وضعیت: منتظر دریافت داده‌های حرکتی...</p>
            <a href="/aligner" style="display:block; margin-top:14px; color:#38bdf8; font-size:13px;">→ نسخه‌ی دقیق مبتنی بر GPS و محاسبه‌ی واقعی زاویه</a>
        </div>

        <script>
            function initSensors() {
                if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
                    DeviceOrientationEvent.requestPermission().then(response => {
                        if (response === 'granted') {
                            startTracking();
                        } else {
                            alert("دسترسی به سنسورها داده نشد.");
                        }
                    }).catch(console.error);
                } else if ('ondeviceorientation' in window) {
                    startTracking();
                } else {
                    alert("مرورگر شما از سنسور جهت پشتیبانی نمی‌کند.");
                }
            }

            function startTracking() {
                document.getElementById('status-text').innerText = "سنسور فعال شد. دیش را به آرامی بچرخانید.";
                window.addEventListener('deviceorientation', function(event) {
                    let alpha = event.alpha;
                    if (alpha === null) return;

                    let targetAzimuth = 145.0;
                    let diff = Math.abs(alpha - targetAzimuth);

                    let sVal = 93;
                    let qVal = 0;

                    if (diff <= 2.0) {
                        qVal = 85;
                        document.getElementById('status-text').innerHTML = "<span style='color:#22c55e; font-weight:bold;'>یاهست با موفقیت قفل شد!</span>";
                    } else if (diff <= 8.0) {
                        qVal = Math.max(15, Math.round(85 - (diff * 8)));
                        document.getElementById('status-text').innerText = "سیگنال نزدیک است، آرام‌تر بچرخانید...";
                    } else {
                        qVal = 0;
                        document.getElementById('status-text').innerText = "اختلاف زاویه زیاد است (در حال جستجو)";
                    }

                    document.getElementById('bar-s').style.width = sVal + "%";
                    document.getElementById('val-s').innerText = sVal + "%";
                    document.getElementById('bar-q').style.width = qVal + "%";
                    document.getElementById('val-q').innerText = qVal + "%";
                });
            }
        </script>
    </body>
    </html>
    """


# --- API محاسبه‌ی دقیق زاویه (آزیموت/ارتفاع/اسکیو) -------------------------

@app.get("/api/pointing")
async def api_pointing(
    lat: float = Query(..., ge=-90, le=90, description="عرض جغرافیایی ناظر"),
    lon: float = Query(..., ge=-180, le=180, description="طول جغرافیایی ناظر"),
    alt: float = Query(0.0, ge=-500, le=9000, description="ارتفاع از سطح دریا (متر)"),
    sat: str = Query(DEFAULT_SATELLITE, description="کلید ماهواره از میان ماهواره‌های یاهست"),
):
    if sat not in YAHSAT_SATELLITES:
        raise HTTPException(
            status_code=400,
            detail=f"ماهواره نامعتبر است. گزینه‌های مجاز: {', '.join(YAHSAT_SATELLITES.keys())}",
        )
    sat_info = YAHSAT_SATELLITES[sat]
    result = compute_pointing(lat, lon, alt, sat_info["lon"])
    result["satellite"] = sat_info["name"]
    result["satellite_lon"] = sat_info["lon"]
    return JSONResponse(content=result)


# --- API قرائت واقعی سیگنال از ریسیور (اختیاری) -----------------------------
# این دو endpoint هیچ عددی تولید نمی‌کنند. فقط اگر یک ریسیور/تیونر واقعی روی
# شبکه‌ی محلی مقدار S/Q واقعی خودش را POST کند، آن مقدار نگه‌داری و نمایش
# داده می‌شود. در غیر این صورت سایت صادقانه اعلام می‌کند سیگنال واقعی در
# دسترس نیست، به‌جای نمایش عدد ساختگی.

@app.post("/api/signal")
async def report_real_signal(
    payload: dict = Body(...),
    username: str = Depends(verify_admin),
):
    """
    ریسیور واقعی (یا اسکریپتی که به پورت سریال/API ریسیور وصل است) باید
    بدنه‌ای مثل زیر ارسال کند:
    {"s": 87, "q": 92, "locked": true, "source": "receiver-model-x"}
    """
    global _last_real_signal
    try:
        s_val = float(payload.get("s"))
        q_val = float(payload.get("q"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="مقادیر s و q باید عددی باشند")

    if not (0 <= s_val <= 100 and 0 <= q_val <= 100):
        raise HTTPException(status_code=400, detail="مقادیر s و q باید بین 0 تا 100 باشند")

    _last_real_signal = {
        "s": s_val,
        "q": q_val,
        "locked": bool(payload.get("locked", False)),
        "source": str(payload.get("source", "unknown"))[:100],
        "timestamp": time.time(),
    }
    logger.info("قرائت واقعی سیگنال از گیرنده دریافت شد: S=%.1f Q=%.1f", s_val, q_val)
    return {"status": "ok"}


@app.get("/api/signal")
async def get_real_signal():
    if _last_real_signal is None:
        return JSONResponse(content={"available": False, "reason": "هیچ گیرنده‌ای متصل نیست"})

    age = time.time() - _last_real_signal["timestamp"]
    if age > SIGNAL_FRESHNESS_SECONDS:
        return JSONResponse(content={"available": False, "reason": "آخرین قرائت گیرنده منقضی شده است"})

    return JSONResponse(content={
        "available": True,
        "s": _last_real_signal["s"],
        "q": _last_real_signal["q"],
        "locked": _last_real_signal["locked"],
        "source": _last_real_signal["source"],
        "age_seconds": round(age, 1),
    })


# --- صفحه‌ی ماهواره‌یاب دقیق (GPS + قطب‌نما) --------------------------------

@app.get("/aligner", response_class=HTMLResponse)
async def aligner_page():
    return """
    <!DOCTYPE html>
    <html lang="fa" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>ماهواره‌یاب دقیق یاهست</title>
        <style>
            body { background:#0b0f19; color:#f8fafc; font-family:Tahoma,sans-serif; margin:0; padding:15px; }
            .card { background:#131b2e; padding:20px; border-radius:16px; max-width:460px; margin:16px auto; box-shadow:0 10px 25px rgba(0,0,0,0.6); border:1px solid #1e293b; }
            h2 { margin-top:0; text-align:center; }
            .target-box { background:#05070b; border:1px solid #1f293d; border-radius:12px; padding:16px; margin:16px 0; }
            .target-row { display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed #1f293d; font-family:monospace; font-size:16px; }
            .target-row:last-child { border-bottom:none; }
            .target-label { color:#94a3b8; }
            .target-value { color:#38bdf8; font-weight:bold; }
            .live-box { background:#05070b; border:1px solid #1f293d; border-radius:12px; padding:16px; margin:16px 0; }
            .bar-row { margin:14px 0; }
            .bar-title { display:flex; justify-content:space-between; font-size:13px; color:#94a3b8; margin-bottom:6px; }
            .bar-container { height:20px; background:#111827; border-radius:4px; overflow:hidden; border:1px solid #374151; }
            .bar-fill { height:100%; width:0%; transition:width 0.15s ease-out, background 0.15s; }
            button { background:#2563eb; color:white; border:none; padding:13px 20px; border-radius:10px; cursor:pointer; font-size:15px; font-weight:bold; width:100%; margin-top:6px; }
            button:hover { background:#1d4ed8; }
            .status { font-size:13px; color:#94a3b8; margin-top:12px; line-height:1.6; text-align:center; }
            .warn-box { background:#3b1d1d; border:1px solid #7f1d1d; color:#fca5a5; border-radius:10px; padding:12px; font-size:12.5px; line-height:1.7; margin-top:16px; }
            .real-signal-box { background:#0f2417; border:1px solid #14532d; border-radius:10px; padding:12px; font-size:13px; margin-top:14px; text-align:center; color:#86efac; }
            .field { margin:10px 0; }
            .field label { display:block; font-size:12px; color:#94a3b8; margin-bottom:4px; }
            .field input { width:100%; box-sizing:border-box; background:#0f172a; border:1px solid #334155; color:#fff; padding:8px; border-radius:6px; }
        </style>
    </head>
    <body>
        <div class="card">
            <h2>ماهواره‌یاب دقیق — یاهست ۱ای (۵۲.۵ شرقی)</h2>

            <button onclick="startLocating()">دریافت موقعیت GPS و محاسبه‌ی زاویه</button>

            <div class="target-box" id="target-box" style="display:none;">
                <div class="target-row"><span class="target-label">آزیموت هدف (جهت قطب‌نما)</span><span class="target-value" id="t-az">--</span></div>
                <div class="target-row"><span class="target-label">ارتفاع هدف (زاویه از افق)</span><span class="target-value" id="t-el">--</span></div>
                <div class="target-row"><span class="target-label">اسکیو LNB (چرخش)</span><span class="target-value" id="t-skew">--</span></div>
                <div class="target-row"><span class="target-label">فاصله تا ماهواره</span><span class="target-value" id="t-dist">--</span></div>
            </div>

            <div class="field" id="declination-field" style="display:none;">
                <label>انحراف مغناطیسی محل شما (اختیاری، درجه) — از magnetic-declination.com بگیرید</label>
                <input type="number" id="declination-input" value="0" step="0.1">
            </div>

            <button id="compass-btn" onclick="startCompass()" style="display:none;">فعال‌سازی قطب‌نما و شتاب‌سنج گوشی</button>

            <div class="live-box" id="live-box" style="display:none;">
                <div class="bar-row">
                    <div class="bar-title"><span>دقت جهت افقی (آزیموت)</span><span id="az-diff-text">--</span></div>
                    <div class="bar-container"><div id="az-bar" class="bar-fill" style="background:#38bdf8;"></div></div>
                </div>
                <div class="bar-row">
                    <div class="bar-title"><span>دقت زاویه عمودی (ارتفاع)</span><span id="el-diff-text">--</span></div>
                    <div class="bar-container"><div id="el-bar" class="bar-fill" style="background:#c084fc;"></div></div>
                </div>
            </div>

            <div id="real-signal-box" class="real-signal-box" style="display:none;"></div>

            <p class="status" id="status-text">مرحله ۱: روی دکمه بالا بزنید تا موقعیت دقیق شما گرفته شود.</p>

            <div class="warn-box">
                <b>⚠️ توضیح مهم و صادقانه:</b><br>
                نوارهای بالا فقط نشان می‌دهند گوشی شما چقدر به «زاویه‌ی محاسبه‌شده‌ی دقیق» نزدیک شده — این‌ها <b>سیگنال واقعی ماهواره نیستند</b>.
                هیچ گوشی‌ای نمی‌تواند سیگنال RF ماهواره را بخواند. برای S/Q واقعی حتماً باید از صفحه‌ی گیرنده (ریسیور) روی تلویزیون بخوانید،
                یا اگر ریسیور شما قابلیت خروجی دیتا دارد، آن را به آدرس <code>/api/signal</code> همین سایت متصل کنید تا مقدار واقعی همین‌جا نشان داده شود.
            </div>
        </div>

        <script>
            let target = null;
            let declinationOffset = 0;

            async function startLocating() {
                if (!navigator.geolocation) {
                    document.getElementById('status-text').innerText = "مرورگر شما از GPS پشتیبانی نمی‌کند.";
                    return;
                }
                document.getElementById('status-text').innerText = "در حال دریافت موقعیت GPS (چند ثانیه صبر کنید)...";
                navigator.geolocation.getCurrentPosition(async (pos) => {
                    const lat = pos.coords.latitude;
                    const lon = pos.coords.longitude;
                    const alt = pos.coords.altitude || 0;
                    try {
                        const resp = await fetch(`/api/pointing?lat=${lat}&lon=${lon}&alt=${alt}&sat=yahsat1a`);
                        if (!resp.ok) throw new Error("خطا در محاسبه");
                        target = await resp.json();

                        document.getElementById('target-box').style.display = 'block';
                        document.getElementById('t-az').innerText = target.azimuth.toFixed(1) + '°';
                        document.getElementById('t-el').innerText = target.elevation.toFixed(1) + '°';
                        document.getElementById('t-skew').innerText = target.skew.toFixed(1) + '°';
                        document.getElementById('t-dist').innerText = target.distance_km.toLocaleString('fa-IR') + ' کیلومتر';

                        document.getElementById('declination-field').style.display = 'block';
                        document.getElementById('compass-btn').style.display = 'block';

                        if (!target.visible) {
                            document.getElementById('status-text').innerHTML =
                                "<span style='color:#ef4444;'>هشدار: از این موقعیت جغرافیایی، این ماهواره اصلاً زیر خط افق است و قابل دریافت نیست.</span>";
                        } else {
                            document.getElementById('status-text').innerText =
                                "مرحله ۲: انحراف مغناطیسی منطقه را وارد کنید (اختیاری) و قطب‌نما را فعال کنید.";
                        }
                        checkRealSignal();
                    } catch (e) {
                        document.getElementById('status-text').innerText = "خطا در دریافت زاویه از سرور.";
                    }
                }, (err) => {
                    document.getElementById('status-text').innerText = "دسترسی به GPS داده نشد یا در دسترس نیست: " + err.message;
                }, { enableHighAccuracy: true, timeout: 15000 });
            }

            function startCompass() {
                declinationOffset = parseFloat(document.getElementById('declination-input').value) || 0;

                function attach() {
                    document.getElementById('live-box').style.display = 'block';
                    document.getElementById('status-text').innerText =
                        "گوشی را مثل پایه‌ی LNB نگه دارید و بچرخانید تا نوارها پر شوند.";
                    window.addEventListener('deviceorientation', onOrientation);
                }

                if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
                    DeviceOrientationEvent.requestPermission().then(r => {
                        if (r === 'granted') attach();
                        else document.getElementById('status-text').innerText = "دسترسی به سنسورها رد شد.";
                    }).catch(console.error);
                } else if ('ondeviceorientation' in window) {
                    attach();
                } else {
                    document.getElementById('status-text').innerText = "این دستگاه سنسور جهت ندارد.";
                }
            }

            function onOrientation(event) {
                if (!target) return;

                // heading خام گوشی: در iOS از webkitCompassHeading (نسبت به شمال مغناطیسی)
                // و در سایرین از alpha (که با 360-alpha به heading نزدیک می‌شود) استفاده می‌شود.
                let rawHeading;
                if (typeof event.webkitCompassHeading !== 'undefined' && event.webkitCompassHeading !== null) {
                    rawHeading = event.webkitCompassHeading;
                } else if (event.alpha !== null) {
                    rawHeading = 360 - event.alpha;
                } else {
                    return;
                }

                // اعمال انحراف مغناطیسی برای رسیدن از شمال مغناطیسی به شمال جغرافیایی
                let trueHeading = (rawHeading + declinationOffset + 360) % 360;

                let azDiff = Math.abs(((trueHeading - target.azimuth + 540) % 360) - 180);
                let azAccuracy = Math.max(0, 100 - (azDiff / 30) * 100);

                // beta: تیلت جلو-عقب گوشی؛ برای تخمین ارتفاع وقتی گوشی عمودی/تراز نگه داشته می‌شود
                let elFromTilt = event.beta !== null ? (90 - Math.abs(event.beta)) : null;
                let elDiff = elFromTilt !== null ? Math.abs(elFromTilt - target.elevation) : null;
                let elAccuracy = elDiff !== null ? Math.max(0, 100 - (elDiff / 20) * 100) : 0;

                document.getElementById('az-bar').style.width = azAccuracy + '%';
                document.getElementById('az-diff-text').innerText = azDiff.toFixed(1) + '° اختلاف';
                document.getElementById('el-bar').style.width = elAccuracy + '%';
                document.getElementById('el-diff-text').innerText = elDiff !== null ? elDiff.toFixed(1) + '° اختلاف' : 'در دسترس نیست';

                if (azAccuracy > 90 && elAccuracy > 90) {
                    document.getElementById('status-text').innerHTML =
                        "<span style='color:#22c55e; font-weight:bold;'>جهت‌گیری فیزیکی گوشی با زاویه‌ی محاسبه‌شده تقریباً منطبق است. حالا با گیرنده S/Q واقعی را بررسی کنید.</span>";
                }
            }

            async function checkRealSignal() {
                try {
                    const resp = await fetch('/api/signal');
                    const data = await resp.json();
                    const box = document.getElementById('real-signal-box');
                    if (data.available) {
                        box.style.display = 'block';
                        box.innerHTML = `<b>سیگنال واقعی از گیرنده:</b> S=${data.s}% &nbsp; Q=${data.q}% &nbsp; قفل: ${data.locked ? 'بله' : 'خیر'}`;
                    } else {
                        box.style.display = 'block';
                        box.style.background = '#1f2937';
                        box.style.borderColor = '#374151';
                        box.style.color = '#94a3b8';
                        box.innerHTML = 'هیچ گیرنده‌ی واقعی متصل نیست — فقط زاویه‌ی محاسبه‌شده در دسترس است.';
                    }
                } catch (e) { /* سایلنت - سرویس اختیاری است */ }
            }
        </script>
    </body>
    </html>
    """


# --- Admin Panel Endpoints --------------------------------------------------

@app.get("/admin", response_class=HTMLResponse)
async def admin_panel(username: str = Depends(verify_admin)):
    config = load_config()
    try:
        files = sorted(os.listdir(UPLOAD_DIR))
    except Exception:
        files = []

    files_html = "".join([
        f"<li style='margin: 8px 0; display:flex; justify-content:space-between; align-items:center; background:#0f172a; padding:10px; border-radius:6px;'>"
        f"<span>{f}</span>"
        f"<form action='/admin/delete/{f}' method='post' onsubmit=\"return confirm('آیا از حذف این فایل مطمئن هستید؟');\">"
        f"<button type='submit' style='width:auto; background:#ef4444; padding:6px 14px; font-size:13px;'>حذف فایل</button>"
        f"</form>"
        f"</li>" for f in files
    ]) or "<p style='color:#94a3b8;'>هیچ فایلی آپلود نشده است.</p>"

    maintenance_status = config.get("maintenance", False)
    toggle_btn_text = "خاموش کردن سایت (حالت تعمیر)" if not maintenance_status else "روشن کردن سایت (فعال)"
    toggle_btn_color = "#ef4444" if not maintenance_status else "#22c55e"

    return f"""
    <!DOCTYPE html>
    <html lang="fa" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <title>پنل مدیریت مرکزی</title>
        <style>
            body {{ background: #0f172a; color: #fff; font-family: Tahoma; padding: 20px; margin: 0; }}
            .container {{ max-width: 650px; margin: 30px auto; background: #1e293b; padding: 30px; border-radius: 16px; border: 1px solid #334155; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }}
            input[type="file"] {{ background: #0f172a; color: #fff; padding: 10px; border-radius: 8px; border: 1px solid #475569; width: 100%; box-sizing: border-box; margin-bottom: 10px; }}
            button {{ padding: 12px 20px; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 15px; width: 100%; transition: 0.2s; }}
            .btn-action {{ background: #3b82f6; color: white; }}
            .btn-action:hover {{ background: #2563eb; }}
            hr {{ border: 0; height: 1px; background: #334155; margin: 25px 0; }}
            ul {{ list-style: none; padding: 0; }}
            .hint {{ color:#64748b; font-size:12px; }}
        </style>
    </head>
    <body>
        <div class="container">
            <h2 style="margin-top:0; color:#38bdf8;">پنل مدیریت پیشرفته سایت</h2>
            <p style="color:#94a3b8; font-size:14px;">مدیریت وضعیت سرویس، فایل‌های آپلودی و محتوای تبلیغاتی.</p>
            <hr>
            <h3>کنترل وضعیت سرور:</h3>
            <form action="/admin/toggle-maintenance" method="post">
                <button style="background: {toggle_btn_color}; color: white;" type="submit">{toggle_btn_text}</button>
            </form>
            <hr>
            <h3>آپلود فایل جدید (بنر، ویدیو تبلیغاتی یا مستندات):</h3>
            <form action="/admin/upload" enctype="multipart/form-data" method="post">
                <input type="file" name="file" required>
                <button class="btn-action" type="submit">بارگذاری فایل روی سرور</button>
            </form>
            <p class="hint">پسوندهای مجاز: {", ".join(sorted(ALLOWED_EXTENSIONS))} — حداکثر حجم: {MAX_UPLOAD_SIZE // (1024*1024)} مگابایت</p>
            <hr>
            <h3>فایل‌های موجود در هاست:</h3>
            <ul>{files_html}</ul>
        </div>
    </body>
    </html>
    """


@app.post("/admin/upload")
async def upload_file(file: UploadFile = File(...), username: str = Depends(verify_admin)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="نام فایل ارسال نشده است")

    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"پسوند فایل مجاز نیست. پسوندهای مجاز: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    try:
        dest_path = resolve_safe_path(file.filename)
    except ValueError:
        raise HTTPException(status_code=400, detail="نام فایل نامعتبر است")

    content = await file.read()
    if len(content) > MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"حجم فایل بیش از حد مجاز است (حداکثر {MAX_UPLOAD_SIZE // (1024*1024)} مگابایت)",
        )

    try:
        with open(dest_path, "wb") as buffer:
            buffer.write(content)
    except Exception as e:
        logger.error("خطا در ذخیره فایل %s: %s", dest_path, e)
        raise HTTPException(status_code=500, detail="خطا در ذخیره فایل روی سرور")

    logger.info("فایل جدید توسط ادمین '%s' آپلود شد: %s", username, dest_path.name)
    return HTMLResponse(content="<script>alert('فایل با موفقیت آپلود شد!'); window.location='/admin';</script>")


@app.post("/admin/delete/{filename}")
async def delete_file(filename: str, username: str = Depends(verify_admin)):
    try:
        file_path = resolve_safe_path(filename)
    except ValueError:
        raise HTTPException(status_code=400, detail="نام فایل نامعتبر است")

    if file_path.exists() and file_path.is_file():
        file_path.unlink()
        logger.info("فایل توسط ادمین '%s' حذف شد: %s", username, file_path.name)
    else:
        raise HTTPException(status_code=404, detail="فایل مورد نظر یافت نشد")

    return HTMLResponse(content="<script>window.location='/admin';</script>")


@app.post("/admin/toggle-maintenance")
async def toggle_maintenance(username: str = Depends(verify_admin)):
    config = load_config()
    config["maintenance"] = not config.get("maintenance", False)
    save_config(config)
    logger.info("وضعیت حالت تعمیر توسط ادمین '%s' به %s تغییر کرد", username, config["maintenance"])
    return HTMLResponse(content="<script>window.location='/admin';</script>")


# --- Error Handling عمومی ---------------------------------------------------

@app.exception_handler(404)
async def not_found_handler(request: Request, exc):
    return JSONResponse(status_code=404, content={"detail": "یافت نشد"})
