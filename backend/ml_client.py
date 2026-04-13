import aiohttp
import asyncio
import json
import logging
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

APP_ID = os.getenv("ML_APP_ID")
SECRET_KEY = os.getenv("ML_SECRET_KEY")
BASE_URL = "https://api.mercadolibre.com"

TOKENS_FILE = Path(__file__).parent / "tokens.json"

INITIAL_TOKENS = {
    "SANCORFASHION": {
        "seller_id": os.getenv("ML_SF_SELLER_ID"),
        "access_token": os.getenv("ML_SF_ACCESS_TOKEN"),
        "refresh_token": os.getenv("ML_SF_REFRESH_TOKEN"),
    },
    "BEKURA": {
        "seller_id": os.getenv("ML_BK_SELLER_ID"),
        "access_token": os.getenv("ML_BK_ACCESS_TOKEN"),
        "refresh_token": os.getenv("ML_BK_REFRESH_TOKEN"),
    },
}


class MLClient:
    def __init__(self):
        self.tokens = self._load_tokens()
        self._session: Optional[aiohttp.ClientSession] = None

    def _load_tokens(self) -> dict:
        if TOKENS_FILE.exists():
            with open(TOKENS_FILE) as f:
                return json.load(f)
        self._save_tokens(INITIAL_TOKENS)
        return dict(INITIAL_TOKENS)

    def _save_tokens(self, tokens: dict):
        with open(TOKENS_FILE, "w") as f:
            json.dump(tokens, f, indent=2)

    async def refresh_token(self, account: str) -> str:
        refresh_token = self.tokens[account]["refresh_token"]
        async with aiohttp.ClientSession(timeout=self._timeout) as session:
            async with session.post(
                f"{BASE_URL}/oauth/token",
                data={
                    "grant_type": "refresh_token",
                    "client_id": APP_ID,
                    "client_secret": SECRET_KEY,
                    "refresh_token": refresh_token,
                },
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    self.tokens[account]["access_token"] = data["access_token"]
                    if "refresh_token" in data:
                        self.tokens[account]["refresh_token"] = data["refresh_token"]
                    self._save_tokens(self.tokens)
                    logger.info(f"Token refreshed for {account}")
                    return data["access_token"]
                text = await resp.text()
                raise Exception(f"Token refresh failed for {account}: {text}")

    _timeout = aiohttp.ClientTimeout(total=20, connect=8)

    async def _get(self, account: str, endpoint: str, params: dict = None, retry: bool = True) -> dict:
        token = self.tokens[account]["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        async with aiohttp.ClientSession(timeout=self._timeout) as session:
            async with session.get(f"{BASE_URL}{endpoint}", params=params, headers=headers) as resp:
                if resp.status == 401 and retry:
                    logger.info(f"Token expired for {account}, refreshing...")
                    token = await self.refresh_token(account)
                    headers["Authorization"] = f"Bearer {token}"
                    async with session.get(f"{BASE_URL}{endpoint}", params=params, headers=headers) as resp2:
                        return await resp2.json()
                if resp.status >= 400:
                    text = await resp.text()
                    logger.warning(f"ML API error {resp.status} for {account} {endpoint}: {text[:200]}")
                    return {}
                return await resp.json()

    async def get_orders(self, account: str, date_from: datetime, date_to: datetime) -> list:
        seller_id = self.tokens[account]["seller_id"]
        all_orders = []
        offset = 0
        limit = 50

        while True:
            params = {
                "seller": seller_id,
                "order.status": "paid",
                "sort": "date_desc",
                "date_created.from": date_from.strftime("%Y-%m-%dT%H:%M:%S.000-00:00"),
                "date_created.to": date_to.strftime("%Y-%m-%dT%H:%M:%S.000-00:00"),
                "offset": offset,
                "limit": limit,
            }
            data = await self._get(account, "/orders/search", params)
            results = data.get("results", [])
            all_orders.extend(results)

            paging = data.get("paging", {})
            total = paging.get("total", 0)
            if offset + limit >= total or not results:
                break
            offset += limit

        return all_orders

    async def get_user_items(self, account: str, status: str = "active", limit_items: int = 200) -> list:
        seller_id = self.tokens[account]["seller_id"]
        all_items = []
        offset = 0
        limit = 50

        while len(all_items) < limit_items:
            data = await self._get(
                account,
                f"/users/{seller_id}/items/search",
                params={"offset": offset, "limit": limit, "status": status},
            )
            item_ids = data.get("results", [])
            all_items.extend(item_ids)

            paging = data.get("paging", {})
            total = paging.get("total", 0)
            if offset + limit >= total or not item_ids:
                break
            offset += limit

        return all_items[:limit_items]

    async def get_item_details_batch(self, account: str, item_ids: list) -> dict:
        """Get item titles in batches of 20"""
        details = {}
        batch_size = 20
        for i in range(0, len(item_ids), batch_size):
            batch = item_ids[i : i + batch_size]
            data = await self._get(account, "/items", params={"ids": ",".join(batch)})
            if isinstance(data, list):
                for item in data:
                    body = item.get("body", {})
                    details[body.get("id", "")] = {
                        "title": body.get("title", ""),
                        "price": body.get("price", 0),
                        "thumbnail": body.get("thumbnail", ""),
                    }
        return details

    async def get_visits(self, account: str, item_ids: list, last_days: int = 30) -> dict:
        """Get visits per item over the last N days"""
        if not item_ids:
            return {}

        daily_visits: dict = {}  # date -> total_visits
        item_visits: dict = {}   # item_id -> total_visits
        batch_size = 50

        for i in range(0, len(item_ids), batch_size):
            batch = item_ids[i : i + batch_size]
            data = await self._get(
                account,
                "/items/visits/time_window",
                params={"ids": ",".join(batch), "last": last_days, "unit": "day"},
            )
            if not isinstance(data, list):
                continue
            for item_data in data:
                iid = item_data.get("id", "")
                item_visits[iid] = item_data.get("total_visits", 0)
                for detail in item_data.get("visits_detail", []):
                    date_key = detail.get("date", "")[:10]
                    daily_visits[date_key] = daily_visits.get(date_key, 0) + detail.get("visits", 0)

        return {"daily": daily_visits, "by_item": item_visits}

    async def get_daily_conversion(self, account: str, days: int = 30) -> list:
        """Return list of {date, orders, visits, rate} for last N days"""
        now = datetime.now()
        date_from = now - timedelta(days=days)

        orders, item_ids = await asyncio.gather(
            self.get_orders(account, date_from, now),
            self.get_user_items(account, limit_items=200),
        )

        visits_data = await self.get_visits(account, item_ids, last_days=days)
        daily_visits = visits_data.get("daily", {})

        daily_orders: dict = {}
        for order in orders:
            date_key = (order.get("date_created") or "")[:10]
            if date_key:
                daily_orders[date_key] = daily_orders.get(date_key, 0) + 1

        # Build last N days
        result = []
        for i in range(days - 1, -1, -1):
            d = (now - timedelta(days=i)).strftime("%Y-%m-%d")
            o = daily_orders.get(d, 0)
            v = daily_visits.get(d, 0)
            rate = round((o / v * 100), 2) if v > 0 else 0
            result.append({"date": d, "orders": o, "visits": v, "rate": rate})

        return result

    async def get_top_products(self, account: str, date_from: datetime, date_to: datetime, limit: int = 10) -> list:
        orders = await self.get_orders(account, date_from, date_to)
        products: dict = {}
        for order in orders:
            for oi in order.get("order_items", []):
                item = oi.get("item", {})
                iid = item.get("id", "")
                title = item.get("title", "")
                qty = oi.get("quantity", 0) or 0
                price = oi.get("unit_price", 0) or 0
                if iid not in products:
                    products[iid] = {"id": iid, "title": title, "units_sold": 0, "revenue": 0, "account": account}
                products[iid]["units_sold"] += qty
                products[iid]["revenue"] += qty * price

        sorted_prods = sorted(products.values(), key=lambda x: x["revenue"], reverse=True)
        return sorted_prods[:limit]

    async def get_slow_products(self, account: str, date_from: datetime, date_to: datetime, threshold: int = 3) -> list:
        """Items with fewer than threshold units sold in the period"""
        orders, item_ids = await asyncio.gather(
            self.get_orders(account, date_from, date_to),
            self.get_user_items(account, limit_items=300),
        )

        # Count sales per item
        sales_count: dict = {}
        for order in orders:
            for oi in order.get("order_items", []):
                item = oi.get("item", {})
                iid = item.get("id", "")
                title = item.get("title", "")
                qty = oi.get("quantity", 0) or 0
                if iid not in sales_count:
                    sales_count[iid] = {"title": title, "qty": 0}
                sales_count[iid]["qty"] += qty

        slow = []
        for iid in item_ids:
            sold = sales_count.get(iid, {}).get("qty", 0)
            if sold < threshold:
                slow.append({
                    "id": iid,
                    "title": sales_count.get(iid, {}).get("title", iid),
                    "units_sold": sold,
                    "account": account,
                })
        # Sort by least sold
        slow.sort(key=lambda x: x["units_sold"])
        return slow[:25]

    async def get_monthly_trend(self, account: str, months: int = 6) -> list:
        now = datetime.utcnow()

        # Build list of (month_start, month_end, ym, label) for each month
        month_ranges = []
        cursor = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        for _ in range(months - 1):
            cursor = (cursor - timedelta(days=1)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        for _ in range(months):
            next_month = (cursor.replace(day=28) + timedelta(days=4)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            month_end = min(next_month, now)
            month_ranges.append((cursor, month_end, cursor.strftime("%Y-%m"), cursor.strftime("%b %Y")))
            cursor = next_month

        # Fetch each month in parallel — avoids ML API pagination cap spreading across months
        order_lists = await asyncio.gather(
            *[self.get_orders(account, m_start, m_end) for m_start, m_end, _, _ in month_ranges],
            return_exceptions=True,
        )

        result = []
        for (m_start, m_end, ym, label), orders in zip(month_ranges, order_lists):
            if isinstance(orders, Exception):
                result.append({"month": label, "year_month": ym, "sales": 0, "orders": 0})
                continue
            total_sales = sum(o.get("total_amount", 0) or 0 for o in orders)
            result.append({
                "month": label,
                "year_month": ym,
                "sales": round(total_sales, 2),
                "orders": len(orders),
            })

        return result
