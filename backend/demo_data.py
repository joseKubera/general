"""Fallback demo data when external APIs are unreachable."""
from datetime import datetime, timedelta
import random

MONTHLY_GOAL = 14_000_000

def _trend_month(offset: int, sf_base: float, bk_base: float) -> dict:
    now = datetime.utcnow()
    cursor = now.replace(day=1)
    for _ in range(offset):
        cursor = (cursor - timedelta(days=1)).replace(day=1)
    sf = round(sf_base * (0.85 + random.random() * 0.3), 2)
    bk = round(bk_base * (0.85 + random.random() * 0.3), 2)
    return {
        "month": cursor.strftime("%b %Y"),
        "year_month": cursor.strftime("%Y-%m"),
        "sancorfashion": sf,
        "bekura": bk,
        "total": round(sf + bk, 2),
    }


def get_demo_dashboard() -> dict:
    random.seed(42)  # reproducible
    now = datetime.utcnow()

    sf_sales  = round(random.uniform(2_800_000, 3_500_000), 2)
    bk_sales  = round(random.uniform(1_200_000, 1_800_000), 2)
    sf_orders = random.randint(220, 320)
    bk_orders = random.randint(80, 140)
    total_sales  = sf_sales + bk_sales
    total_orders = sf_orders + bk_orders

    monthly_trend = [_trend_month(i, 3_100_000, 1_400_000) for i in range(5, -1, -1)]

    # Daily conversion last 30 days
    daily_conv = []
    for i in range(29, -1, -1):
        d = (now - timedelta(days=i)).strftime("%Y-%m-%d")
        sf_v = random.randint(200, 600)
        bk_v = random.randint(80, 250)
        sf_o = random.randint(3, 20)
        bk_o = random.randint(1, 10)
        daily_conv.append({
            "date": d,
            "sf_orders": sf_o, "sf_visits": sf_v,
            "sf_rate": round(sf_o / sf_v * 100, 2),
            "bk_orders": bk_o, "bk_visits": bk_v,
            "bk_rate": round(bk_o / bk_v * 100, 2),
            "total_orders": sf_o + bk_o,
            "total_visits": sf_v + bk_v,
            "total_rate": round((sf_o + bk_o) / (sf_v + bk_v) * 100, 2),
        })

    top_products = [
        {"rank": 1, "id": "MLM1234567", "title": "Vestido Floral Verano 2026", "account": "SANCORFASHION", "units_sold": 87, "revenue": 522000},
        {"rank": 2, "id": "MLM2345678", "title": "Pantalón Slim Fit Negro", "account": "SANCORFASHION", "units_sold": 65, "revenue": 390000},
        {"rank": 3, "id": "MLM3456789", "title": "Blusa Manga Larga Premium", "account": "BEKURA", "units_sold": 54, "revenue": 324000},
        {"rank": 4, "id": "MLM4567890", "title": "Falda Midi Plisada", "account": "SANCORFASHION", "units_sold": 48, "revenue": 288000},
        {"rank": 5, "id": "MLM5678901", "title": "Conjunto Deportivo Dama", "account": "BEKURA", "units_sold": 42, "revenue": 252000},
        {"rank": 6, "id": "MLM6789012", "title": "Chamarra Primavera Ligera", "account": "SANCORFASHION", "units_sold": 38, "revenue": 228000},
        {"rank": 7, "id": "MLM7890123", "title": "Shorts Casual Mujer", "account": "BEKURA", "units_sold": 35, "revenue": 175000},
        {"rank": 8, "id": "MLM8901234", "title": "Camiseta Oversize Algodón", "account": "SANCORFASHION", "units_sold": 31, "revenue": 155000},
        {"rank": 9, "id": "MLM9012345", "title": "Jeans Skinny Azul Oscuro", "account": "SANCORFASHION", "units_sold": 29, "revenue": 145000},
        {"rank": 10,"id": "MLM0123456", "title": "Suéter Tejido Otoño", "account": "BEKURA", "units_sold": 24, "revenue": 120000},
    ]

    slow_products = [
        {"id": "MLM1111111", "title": "Abrigo Lana Gruesa (Temporada pasada)", "account": "SANCORFASHION", "units_sold": 0},
        {"id": "MLM2222222", "title": "Blusa Transparente Noche", "account": "BEKURA", "units_sold": 1},
        {"id": "MLM3333333", "title": "Pantalón Palazzo Estampado", "account": "SANCORFASHION", "units_sold": 1},
        {"id": "MLM4444444", "title": "Vestido Formal Largo Gris", "account": "BEKURA", "units_sold": 2},
        {"id": "MLM5555555", "title": "Top Brillante Fiesta", "account": "SANCORFASHION", "units_sold": 0},
        {"id": "MLM6666666", "title": "Falda Cuero Sintético", "account": "BEKURA", "units_sold": 2},
        {"id": "MLM7777777", "title": "Jumpsuit Formal Café", "account": "SANCORFASHION", "units_sold": 1},
        {"id": "MLM8888888", "title": "Kimono Verano 2024", "account": "BEKURA", "units_sold": 0},
    ]

    inv_value = round(random.uniform(8_000_000, 12_000_000), 2)
    rotation_pct = round(total_sales / inv_value * 100, 2)

    today_entry = daily_conv[-1]
    return {
        "kpis": {
            "sancorfashion": {
                "sales": sf_sales, "orders": sf_orders,
                "avg_ticket": round(sf_sales / sf_orders, 2),
            },
            "bekura": {
                "sales": bk_sales, "orders": bk_orders,
                "avg_ticket": round(bk_sales / bk_orders, 2),
            },
            "combined": {
                "total_sales": total_sales,
                "total_orders": total_orders,
                "avg_ticket": round(total_sales / total_orders, 2),
                "period": now.strftime("%b %Y"),
            },
        },
        "goal": {
            "amount": MONTHLY_GOAL,
            "month": "Abril 2026",
            "current": 0.0,
            "percentage": 0.0,
            "remaining": float(MONTHLY_GOAL),
            "days_elapsed": 0,
            "days_remaining": 30,
            "needed_per_day": round(MONTHLY_GOAL / 30, 2),
        },
        "monthly_trend": monthly_trend,
        "daily_conversion": daily_conv,
        "top_products": top_products,
        "slow_products": slow_products,
        "inventory": {
            "inventory_value": inv_value,
            "inventory_units": random.randint(4000, 8000),
            "product_count": random.randint(150, 300),
            "sales_revenue": total_sales,
            "rotation_percentage": rotation_pct,
            "status": "demo",
        },
        "meta": {
            "updated_at": now.isoformat(),
            "from_cache": False,
            "mode": "DEMO – APIs no disponibles en este entorno",
        },
    }
