"""
top_products_report.py
======================
Consulta la API de Odoo (XML-RPC) y devuelve:
  1. Campos disponibles del modelo product.product
  2. Top 3 productos por VALOR DE INVENTARIO (qty × costo estándar)
  3. Top 3 productos por PRECIO DE VENTA (list_price)

Uso:
    python backend/top_products_report.py
"""

import xmlrpc.client
from datetime import datetime

# ── Credenciales ──────────────────────────────────────────────────────────────
ODOO_URL = "https://ifullmx-brea.odoo.com"
ODOO_DB = "ifullmx-brea-main-6396587"
ODOO_USER = "jose@kubera.mx"
ODOO_PASSWORD = "dc2be900dfcf1cc596dec0919d129ebb549daeb7"

# ── Autenticación ─────────────────────────────────────────────────────────────
def authenticate():
    common = xmlrpc.client.ServerProxy(f"{ODOO_URL}/xmlrpc/2/common", allow_none=True)
    uid = common.authenticate(ODOO_DB, ODOO_USER, ODOO_PASSWORD, {})
    if not uid:
        raise Exception("Fallo la autenticación con Odoo")
    return uid

def execute(uid, model, method, *args, **kwargs):
    models = xmlrpc.client.ServerProxy(f"{ODOO_URL}/xmlrpc/2/object", allow_none=True)
    return models.execute_kw(ODOO_DB, uid, ODOO_PASSWORD, model, method, list(args), kwargs)


# ── Datos de Campos disponibles ───────────────────────────────────────────────
def print_available_fields(uid):
    fields_info = execute(uid, "product.product", "fields_get", [],
                          attributes=["string", "type"])
    relevant = ["price", "cost", "value", "name", "categ", "qty",
                "stock", "sale", "standard", "barcode", "uom", "type", "code"]
    print("\n" + "="*60)
    print("  CAMPOS DISPONIBLES EN product.product (selección relevante)")
    print("="*60)
    for fname, finfo in sorted(fields_info.items()):
        if any(k in fname.lower() for k in relevant):
            print(f"  {fname:<30} {finfo['string']:<30} ({finfo['type']})")


# ── Top 3 por Valor de Inventario ─────────────────────────────────────────────
def top3_por_valor_inventario(uid):
    quants = execute(
        uid, "stock.quant", "search_read",
        [["location_id.usage", "=", "internal"]],
        fields=["product_id", "quantity", "value"],
        limit=10000,
    )

    productos: dict = {}
    for q in quants:
        qty = q.get("quantity") or 0
        val = q.get("value") or 0
        if qty <= 0:
            continue
        pid = q["product_id"][0]
        pname = q["product_id"][1]
        if pid not in productos:
            productos[pid] = {"name": pname, "qty": 0, "value": 0}
        productos[pid]["qty"] += qty
        productos[pid]["value"] += val

    top3 = sorted(productos.values(), key=lambda x: x["value"], reverse=True)[:3]
    return top3


# ── Top 3 por Precio de Venta ─────────────────────────────────────────────────
def top3_por_precio_venta(uid):
    products = execute(
        uid, "product.product", "search_read",
        [["active", "=", True], ["sale_ok", "=", True]],
        fields=["name", "list_price", "standard_price", "categ_id",
                "qty_available", "default_code", "uom_id"],
        limit=10000,
        order="list_price desc",
    )
    return products[:3]


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    print(f"\nConectando a Odoo: {ODOO_URL}")
    uid = authenticate()
    print(f"Autenticado — UID: {uid}")

    # 1. Campos disponibles
    print_available_fields(uid)

    # 2. Top 3 por valor de inventario
    print("\n" + "="*60)
    print("  TOP 3 PRODUCTOS POR VALOR DE INVENTARIO (qty × costo)")
    print("="*60)
    top_inv = top3_por_valor_inventario(uid)
    for i, p in enumerate(top_inv, 1):
        print(f"\n  #{i}  {p['name']}")
        print(f"       Unidades en stock : {p['qty']:,.2f}")
        print(f"       Valor total        : ${p['value']:,.2f} MXN")

    # 3. Top 3 por precio de venta
    print("\n" + "="*60)
    print("  TOP 3 PRODUCTOS POR PRECIO DE VENTA (list_price)")
    print("="*60)
    top_price = top3_por_precio_venta(uid)
    for i, p in enumerate(top_price, 1):
        ref = p.get("default_code") or "—"
        categ = p.get("categ_id", ["", "—"])[1] if p.get("categ_id") else "—"
        uom = p.get("uom_id", ["", "—"])[1] if p.get("uom_id") else "—"
        print(f"\n  #{i}  {p['name']}")
        print(f"       Referencia          : {ref}")
        print(f"       Categoría           : {categ}")
        print(f"       Unidad de medida    : {uom}")
        print(f"       Precio de venta     : ${p['list_price']:,.2f} MXN")
        print(f"       Costo estándar      : ${p['standard_price']:,.2f} MXN")
        print(f"       Cantidad disponible : {p['qty_available']:,.2f}")

    print("\n" + "="*60)
    print(f"  Reporte generado: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*60 + "\n")


if __name__ == "__main__":
    main()
