import asyncio
import logging
import time
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from odoo_client import OdooClient
from ml_client import MLClient
from demo_data import get_demo_dashboard

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

MONTHLY_GOAL = 14_000_000  # MXN
GOAL_MONTH = "Abril 2026"
GOAL_YEAR = 2026
GOAL_MONTH_NUM = 4

app = FastAPI(title="Sales Dashboard API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

odoo = OdooClient()
ml = MLClient()

# Simple in-memory cache
_cache: dict = {}
CACHE_TTL = 300  # 5 minutes


def cache_get(key: str):
    entry = _cache.get(key)
    if entry and time.time() < entry["expires"]:
        return entry["data"]
    return None


def cache_set(key: str, data, ttl: int = CACHE_TTL):
    _cache[key] = {"data": data, "expires": time.time() + ttl}


def _safe(result, fallback):
    return result if not isinstance(result, Exception) else fallback


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
async def index():
    return FileResponse(str(FRONTEND_DIR / "index.html"))


@app.get("/api/dashboard")
async def dashboard():
    cached = cache_get("dashboard")
    if cached:
        cached["from_cache"] = True
        return cached

    now = datetime.utcnow()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    last_30 = now - timedelta(days=30)

    # ── Parallel fetch all data ──────────────────────────────────────────────
    try:
        (
            sf_orders_month, bk_orders_month,
            sf_orders_30d, bk_orders_30d,
            sf_trend, bk_trend,
            sf_conv, bk_conv,
            sf_top, bk_top,
            sf_slow, bk_slow,
            odoo_inv,
        ) = await asyncio.wait_for(
            asyncio.gather(
                ml.get_orders("SANCORFASHION", month_start, now),
                ml.get_orders("BEKURA", month_start, now),
                ml.get_orders("SANCORFASHION", last_30, now),
                ml.get_orders("BEKURA", last_30, now),
                ml.get_monthly_trend("SANCORFASHION", months=6),
                ml.get_monthly_trend("BEKURA", months=6),
                ml.get_daily_conversion("SANCORFASHION", days=30),
                ml.get_daily_conversion("BEKURA", days=30),
                ml.get_top_products("SANCORFASHION", month_start, now, limit=10),
                ml.get_top_products("BEKURA", month_start, now, limit=10),
                ml.get_slow_products("SANCORFASHION", last_30, now),
                ml.get_slow_products("BEKURA", last_30, now),
                odoo.get_inventory_rotation(month_start, now),
                return_exceptions=True,
            ),
            timeout=25.0,
        )
    except (asyncio.TimeoutError, OSError, Exception) as fetch_err:
        logger.warning(f"Live APIs unavailable ({fetch_err}), serving demo data")
        demo = get_demo_dashboard()
        cache_set("dashboard", demo)
        return demo

    # If all ML calls failed (no network), fallback to demo
    all_failed = all(isinstance(r, Exception) for r in [sf_orders_month, bk_orders_month, sf_orders_30d, bk_orders_30d, sf_trend, bk_trend])
    if all_failed:
        logger.warning("All ML API calls failed, serving demo data")
        demo = get_demo_dashboard()
        cache_set("dashboard", demo)
        return demo

    # ── KPIs ────────────────────────────────────────────────────────────────
    def orders_to_kpi(orders):
        if isinstance(orders, Exception):
            return {"sales": 0, "orders": 0, "avg_ticket": 0, "error": str(orders)}
        total = sum(o.get("total_amount", 0) or 0 for o in orders)
        count = len(orders)
        return {"sales": round(total, 2), "orders": count, "avg_ticket": round(total / count, 2) if count else 0}

    sf_kpi = orders_to_kpi(sf_orders_month)
    bk_kpi = orders_to_kpi(bk_orders_month)
    combined_sales = sf_kpi["sales"] + bk_kpi["sales"]
    combined_orders = sf_kpi["orders"] + bk_kpi["orders"]

    # ── April goal progress ─────────────────────────────────────────────────
    if now.month == GOAL_MONTH_NUM and now.year == GOAL_YEAR:
        goal_current = combined_sales
    else:
        goal_current = 0.0

    days_in_month = 30
    days_elapsed = max(1, now.day) if (now.month == GOAL_MONTH_NUM and now.year == GOAL_YEAR) else 0
    days_remaining = max(1, days_in_month - days_elapsed)
    needed_per_day = round((MONTHLY_GOAL - goal_current) / days_remaining, 2)
    actual_per_day = round(goal_current / max(1, days_elapsed), 2)
    projection = round(actual_per_day * days_in_month, 2)

    goal_info = {
        "amount": MONTHLY_GOAL,
        "month": GOAL_MONTH,
        "current": round(goal_current, 2),
        "percentage": round(goal_current / MONTHLY_GOAL * 100, 2),
        "remaining": round(max(0, MONTHLY_GOAL - goal_current), 2),
        "days_elapsed": days_elapsed,
        "days_remaining": days_remaining,
        "needed_per_day": needed_per_day,
        "actual_per_day": actual_per_day,
        "needed_per_week": round(needed_per_day * 7, 2),
        "actual_per_week": round(actual_per_day * 7, 2),
        "projection": projection,
        "pace_ratio": round(actual_per_day / needed_per_day * 100, 1) if needed_per_day > 0 else 100,
        "sf_pct": round(sf_kpi["sales"] / MONTHLY_GOAL * 100, 2),
        "bk_pct": round(bk_kpi["sales"] / MONTHLY_GOAL * 100, 2),
    }

    # ── Daily revenue (last 30 days) ────────────────────────────────────────
    rev_map: dict = {}
    for o in (_safe(sf_orders_30d, []) or []):
        d = (o.get("date_created") or "")[:10]
        if d:
            rev_map.setdefault(d, {"date": d, "sf": 0.0, "bk": 0.0})
            rev_map[d]["sf"] += o.get("total_amount", 0) or 0
    for o in (_safe(bk_orders_30d, []) or []):
        d = (o.get("date_created") or "")[:10]
        if d:
            rev_map.setdefault(d, {"date": d, "sf": 0.0, "bk": 0.0})
            rev_map[d]["bk"] += o.get("total_amount", 0) or 0

    daily_revenue = []
    for i in range(29, -1, -1):
        d = (now - timedelta(days=i)).strftime("%Y-%m-%d")
        entry = rev_map.get(d, {"date": d, "sf": 0.0, "bk": 0.0})
        daily_revenue.append({
            "date": d,
            "sf": round(entry["sf"], 2),
            "bk": round(entry["bk"], 2),
            "total": round(entry["sf"] + entry["bk"], 2),
        })

    # ── Monthly trend (merge both accounts) ─────────────────────────────────
    trend_map: dict = {}
    for item in (_safe(sf_trend, []) or []):
        ym = item["year_month"]
        if ym not in trend_map:
            trend_map[ym] = {"month": item["month"], "year_month": ym, "sancorfashion": 0, "bekura": 0, "total": 0}
        trend_map[ym]["sancorfashion"] += item["sales"]
        trend_map[ym]["total"] += item["sales"]

    for item in (_safe(bk_trend, []) or []):
        ym = item["year_month"]
        if ym not in trend_map:
            trend_map[ym] = {"month": item["month"], "year_month": ym, "sancorfashion": 0, "bekura": 0, "total": 0}
        trend_map[ym]["bekura"] += item["sales"]
        trend_map[ym]["total"] += item["sales"]

    monthly_trend = sorted(trend_map.values(), key=lambda x: x["year_month"])

    # ── Conversion (merge by date) ──────────────────────────────────────────
    conv_map: dict = {}
    for entry in (_safe(sf_conv, []) or []):
        d = entry["date"]
        conv_map[d] = {
            "date": d,
            "sf_orders": entry["orders"], "sf_visits": entry["visits"], "sf_rate": entry["rate"],
            "bk_orders": 0, "bk_visits": 0, "bk_rate": 0,
        }
    for entry in (_safe(bk_conv, []) or []):
        d = entry["date"]
        if d not in conv_map:
            conv_map[d] = {"date": d, "sf_orders": 0, "sf_visits": 0, "sf_rate": 0,
                           "bk_orders": 0, "bk_visits": 0, "bk_rate": 0}
        conv_map[d]["bk_orders"] = entry["orders"]
        conv_map[d]["bk_visits"] = entry["visits"]
        conv_map[d]["bk_rate"] = entry["rate"]

    # combined rate per day
    conv_list = []
    for d, v in sorted(conv_map.items()):
        total_orders = v["sf_orders"] + v["bk_orders"]
        total_visits = v["sf_visits"] + v["bk_visits"]
        v["total_orders"] = total_orders
        v["total_visits"] = total_visits
        v["total_rate"] = round(total_orders / total_visits * 100, 2) if total_visits > 0 else 0
        conv_list.append(v)

    # ── Top products (merge & sort) ─────────────────────────────────────────
    all_top: dict = {}
    for p in (_safe(sf_top, []) or []) + (_safe(bk_top, []) or []):
        pid = p["id"]
        if pid not in all_top:
            all_top[pid] = dict(p)
        else:
            all_top[pid]["units_sold"] += p["units_sold"]
            all_top[pid]["revenue"] += p["revenue"]

    top_products = sorted(all_top.values(), key=lambda x: x["revenue"], reverse=True)[:15]
    for i, p in enumerate(top_products, 1):
        p["rank"] = i

    # ── Slow products ───────────────────────────────────────────────────────
    slow_sf = _safe(sf_slow, []) or []
    slow_bk = _safe(bk_slow, []) or []
    slow_products = (slow_sf + slow_bk)[:30]

    # ── Response ────────────────────────────────────────────────────────────
    data = {
        "kpis": {
            "sancorfashion": sf_kpi,
            "bekura": bk_kpi,
            "combined": {
                "total_sales": round(combined_sales, 2),
                "total_orders": combined_orders,
                "avg_ticket": round(combined_sales / combined_orders, 2) if combined_orders else 0,
                "period": month_start.strftime("%b %Y"),
            },
        },
        "goal": goal_info,
        "daily_revenue": daily_revenue,
        "monthly_trend": monthly_trend,
        "daily_conversion": conv_list,
        "top_products": top_products,
        "slow_products": slow_products,
        "inventory": _safe(odoo_inv, {"error": str(odoo_inv) if isinstance(odoo_inv, Exception) else "N/A"}),
        "meta": {"updated_at": now.isoformat(), "from_cache": False},
    }

    cache_set("dashboard", data)
    return data


@app.get("/api/refresh")
async def refresh_cache():
    """Force a cache refresh"""
    _cache.clear()
    return JSONResponse({"status": "Cache cleared. Next /api/dashboard call will fetch fresh data."})
