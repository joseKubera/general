import xmlrpc.client
import asyncio
import logging
import os
import ssl
from datetime import datetime, timedelta
from typing import Optional

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

logger = logging.getLogger(__name__)

ODOO_URL = os.environ["ODOO_URL"]
ODOO_DB = os.environ["ODOO_DB"]
ODOO_USER = os.environ["ODOO_USER"]
ODOO_PASSWORD = os.environ["ODOO_PASSWORD"]


class OdooClient:
    def __init__(self):
        self.url = ODOO_URL
        self.db = ODOO_DB
        self.username = ODOO_USER
        self.password = ODOO_PASSWORD
        self._uid: Optional[int] = None

    def _authenticate(self) -> int:
        ssl_ctx = ssl.create_default_context()
        ssl_ctx.check_hostname = False
        ssl_ctx.verify_mode = ssl.CERT_NONE
        common = xmlrpc.client.ServerProxy(f"{self.url}/xmlrpc/2/common", allow_none=True, context=ssl_ctx)
        uid = common.authenticate(self.db, self.username, self.password, {})
        if not uid:
            raise Exception("Odoo authentication failed")
        return uid

    def _get_uid(self) -> int:
        if not self._uid:
            self._uid = self._authenticate()
        return self._uid

    def _execute(self, model: str, method: str, *args, **kwargs):
        uid = self._get_uid()
        ssl_ctx = ssl.create_default_context()
        ssl_ctx.check_hostname = False
        ssl_ctx.verify_mode = ssl.CERT_NONE
        models = xmlrpc.client.ServerProxy(f"{self.url}/xmlrpc/2/object", allow_none=True, context=ssl_ctx)
        return models.execute_kw(self.db, uid, self.password, model, method, list(args), kwargs)

    def _get_inventory_value_sync(self) -> dict:
        try:
            quants = self._execute(
                "stock.quant", "search_read",
                [["location_id.usage", "=", "internal"]],
                fields=["product_id", "quantity", "value"],
                limit=10000,
            )
            total_value = sum(q.get("value", 0) or 0 for q in quants if (q.get("quantity") or 0) > 0)
            total_units = sum(q.get("quantity", 0) or 0 for q in quants if (q.get("quantity") or 0) > 0)
            active_products = len({q["product_id"][0] for q in quants if (q.get("quantity") or 0) > 0})
            return {
                "total_value": round(total_value, 2),
                "total_units": round(total_units, 2),
                "product_count": active_products,
            }
        except Exception as e:
            logger.error(f"Odoo inventory error: {e}")
            return {"total_value": 0, "total_units": 0, "product_count": 0, "error": str(e)}

    def _get_sales_sync(self, date_from: datetime, date_to: datetime) -> dict:
        try:
            orders = self._execute(
                "sale.order", "search_read",
                [
                    ["state", "in", ["sale", "done"]],
                    ["date_order", ">=", date_from.strftime("%Y-%m-%d %H:%M:%S")],
                    ["date_order", "<=", date_to.strftime("%Y-%m-%d %H:%M:%S")],
                ],
                fields=["id", "amount_total", "date_order"],
                limit=10000,
            )
            total_revenue = sum(o.get("amount_total", 0) or 0 for o in orders)
            return {
                "total_revenue": round(total_revenue, 2),
                "order_count": len(orders),
            }
        except Exception as e:
            logger.error(f"Odoo sales error: {e}")
            return {"total_revenue": 0, "order_count": 0, "error": str(e)}

    def _get_top_products_sync(self, date_from: datetime, date_to: datetime, limit: int = 10) -> list:
        try:
            lines = self._execute(
                "sale.order.line", "search_read",
                [
                    ["order_id.state", "in", ["sale", "done"]],
                    ["order_id.date_order", ">=", date_from.strftime("%Y-%m-%d %H:%M:%S")],
                    ["order_id.date_order", "<=", date_to.strftime("%Y-%m-%d %H:%M:%S")],
                ],
                fields=["product_id", "product_uom_qty", "price_subtotal"],
                limit=50000,
            )
            products: dict = {}
            for line in lines:
                pid = line["product_id"][0]
                pname = line["product_id"][1]
                if pid not in products:
                    products[pid] = {"name": pname, "qty": 0, "revenue": 0, "source": "odoo"}
                products[pid]["qty"] += line.get("product_uom_qty", 0) or 0
                products[pid]["revenue"] += line.get("price_subtotal", 0) or 0
            sorted_products = sorted(products.values(), key=lambda x: x["revenue"], reverse=True)
            return sorted_products[:limit]
        except Exception as e:
            logger.error(f"Odoo top products error: {e}")
            return []

    # ── Async wrappers ────────────────────────────────────────────────────────
    async def get_inventory_value(self) -> dict:
        return await asyncio.to_thread(self._get_inventory_value_sync)

    async def get_sales(self, date_from: datetime, date_to: datetime) -> dict:
        return await asyncio.to_thread(self._get_sales_sync, date_from, date_to)

    async def get_inventory_rotation(self, date_from: datetime, date_to: datetime) -> dict:
        inventory, sales = await asyncio.gather(
            self.get_inventory_value(),
            self.get_sales(date_from, date_to),
        )
        inv_value = inventory.get("total_value", 0)
        sales_rev = sales.get("total_revenue", 0)
        rotation_pct = round((sales_rev / inv_value * 100), 2) if inv_value > 0 else 0
        return {
            "inventory_value": inv_value,
            "inventory_units": inventory.get("total_units", 0),
            "product_count": inventory.get("product_count", 0),
            "sales_revenue": sales_rev,
            "rotation_percentage": rotation_pct,
            "status": "connected" if "error" not in inventory else "error",
        }

    async def get_top_products(self, date_from: datetime, date_to: datetime, limit: int = 10) -> list:
        return await asyncio.to_thread(self._get_top_products_sync, date_from, date_to, limit)
