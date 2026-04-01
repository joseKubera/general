"""
Script de prueba para validar datos de inventario y rotación desde Odoo.
Ejecutar: python test_odoo_inventory.py
"""
import asyncio
import json
from datetime import datetime, timedelta
from odoo_client import OdooClient

async def main():
    client = OdooClient()
    now = datetime.now()
    date_from_30 = now - timedelta(days=30)
    date_from_90 = now - timedelta(days=90)

    print("\n" + "="*60)
    print("VALOR DE INVENTARIO (stock.quant - ubicaciones internas)")
    print("="*60)
    inv = await client.get_inventory_value()
    print(json.dumps(inv, indent=2, ensure_ascii=False))

    print("\n" + "="*60)
    print("VENTAS ÚLTIMOS 30 DÍAS (sale.order confirmed/done)")
    print("="*60)
    sales_30 = await client.get_sales(date_from_30, now)
    print(json.dumps(sales_30, indent=2, ensure_ascii=False))

    print("\n" + "="*60)
    print("VENTAS ÚLTIMOS 90 DÍAS")
    print("="*60)
    sales_90 = await client.get_sales(date_from_90, now)
    print(json.dumps(sales_90, indent=2, ensure_ascii=False))

    print("\n" + "="*60)
    print("ROTACIÓN CALCULADA")
    print("="*60)
    inv_value = inv.get("total_value", 0)
    for label, sales in [("30 días", sales_30), ("90 días", sales_90)]:
        revenue = sales.get("total_revenue", 0)
        rotation = round(revenue / inv_value * 100, 2) if inv_value > 0 else 0
        print(f"  [{label}]  ventas={revenue:,.2f}  inventario={inv_value:,.2f}  rotación={rotation}%")

    print("\n" + "="*60)
    print("TOP 10 PRODUCTOS POR REVENUE (30 días)")
    print("="*60)
    top = await client.get_top_products(date_from_30, now, limit=10)
    for i, p in enumerate(top, 1):
        print(f"  {i:2}. {p['name'][:50]:<50}  qty={p['qty']:>8.1f}  rev={p['revenue']:>12,.2f}")

    print("\n" + "="*60)
    print("MUESTRA RAW: primeros 5 registros de stock.quant")
    print("="*60)
    quants = client._execute(
        "stock.quant", "search_read",
        [["location_id.usage", "=", "internal"]],
        fields=["product_id", "quantity", "value", "location_id"],
        limit=5,
    )
    print(json.dumps(quants, indent=2, ensure_ascii=False))

asyncio.run(main())
