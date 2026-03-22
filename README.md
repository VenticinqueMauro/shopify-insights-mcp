# Shopify Insights MCP

> MCP Server de analytics e inteligencia de negocio para Shopify. No solo datos — **insights accionables**.

## Diferenciación

Los MCP existentes para Shopify devuelven datos crudos. Shopify Insights MCP genera **comparativas, alertas y recomendaciones**:

| Otros MCP | Shopify Insights MCP |
|-----------|---------------------|
| "Tienes $45,000 en ventas" | "Llevas $45,000, **12% menos** que el mes pasado" |
| "Lista de 50 productos" | "5 productos tienen **stock crítico** y alta demanda" |
| "10 pedidos pendientes" | "3 pedidos llevan **más de 5 días** sin enviar" |

## Stack

- **TypeScript** + **MCP SDK** (`@modelcontextprotocol/sdk`)
- **Shopify Admin API** (GraphQL)
- **Zod** para validación de inputs
- Transporte: **stdio**

## Instalación

```bash
git clone <repo-url>
cd shopify-insights-mcp
npm install
```

### Configuración

Crea un archivo `.env` basado en `.env.example`:

```env
SHOPIFY_SHOP_DOMAIN=tu-tienda.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_tu_token_aqui
SHOPIFY_CLIENT_ID=tu_client_id
SHOPIFY_CLIENT_SECRET=tu_client_secret
```

**Requisitos de la app Shopify:**
- Scopes: `read_orders`, `read_products`, `read_customers`
- API version: `2024-01`

### Build & Run

```bash
npm run build       # Compila TypeScript → dist/
npm start           # Ejecuta el server MCP (stdio)
npm run dev         # Ejecuta con ts-node (desarrollo)
npm run inspector   # Abre MCP Inspector para debugging
```

## Uso con Claude Desktop

Agrega la configuración en `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "shopify-insights": {
      "command": "node",
      "args": ["ruta/a/shopify-insights-mcp/dist/index.js"],
      "env": {
        "SHOPIFY_SHOP_DOMAIN": "tu-tienda.myshopify.com",
        "SHOPIFY_ACCESS_TOKEN": "shpat_tu_token"
      }
    }
  }
}
```

## Tools (10)

### Ventas & Revenue

| Tool | Descripción |
|------|-------------|
| `get_sales_summary` | Resumen de ventas con comparativa vs. período anterior. Inputs: `period`, `compareWithPrevious` |
| `get_sales_comparison` | Compara dos períodos específicos lado a lado con % de cambio |
| `get_revenue_breakdown` | Revenue desglosado por producto, vendedor o tipo de producto |

### Productos & Inventario

| Tool | Descripción |
|------|-------------|
| `get_product_performance` | Ranking de productos por revenue, unidades vendidas o cantidad de pedidos |
| `get_inventory_alerts` | Alertas de stock: productos agotados, stock bajo, sobrestock |
| `get_trending_products` | Productos en tendencia (subiendo/bajando) vs. período anterior |

### Clientes

| Tool | Descripción |
|------|-------------|
| `get_customer_segments` | Segmentación automática: VIP, Leales, Retornantes, Nuevos, Inactivos |
| `get_top_customers` | Ranking de clientes por gasto total o cantidad de pedidos |

### Operaciones & Pedidos

| Tool | Descripción |
|------|-------------|
| `get_order_alerts` | Pedidos que requieren atención: envíos demorados, problemas financieros, alto valor pendiente |
| `get_fulfillment_metrics` | Métricas operativas: tasa de fulfillment, estado financiero, score de salud |

## Arquitectura

```
src/
├── index.ts                  # Entry point (carga .env, inicia server)
├── server.ts                 # Registro de tools y request handler
├── shopify/
│   ├── auth.ts               # Credenciales desde .env
│   ├── client.ts             # Wrapper GraphQL
│   └── queries/              # Queries de orders, products, customers
├── tools/
│   ├── sales/                # 3 tools de ventas
│   ├── products/             # 3 tools de productos
│   ├── customers/            # 2 tools de clientes
│   └── operations/           # 2 tools operativos
├── analytics/
│   ├── comparisons.ts        # Cálculo de cambios (%, dirección)
│   ├── insights.ts           # Generación de insights automáticos
│   └── recommendations.ts    # Recomendaciones accionables
├── types/
│   └── shopify.ts            # Tipos compartidos de GraphQL
└── utils/
    ├── dates.ts              # Períodos, formateo de fechas
    ├── formatting.ts         # Moneda, porcentajes, números
    └── errors.ts             # Manejo de errores estándar
```

## Ejemplo de output

```
📊 RESUMEN DE VENTAS - ESTE MES

MÉTRICAS ACTUALES:
• Revenue: $1,245,000.00
• Pedidos: 234
• Ticket promedio: $5,320.51
• Unidades vendidas: 892

VS. MES ANTERIOR:
• Revenue: +18.0% (+$190,000.00)
• Pedidos: +12.0% (+25)
• Ticket promedio: +5.4% (+$272.00)

💡 INSIGHTS:
• 📈 Los ingresos crecieron un 18.0% respecto al período anterior.
• 🛒 El volumen de pedidos aumentó un 12.0% (+25 pedidos).

📋 RECOMENDACIONES:
• 🚀 Aprovecha el momentum positivo aumentando la inversión en los canales que mejor funcionan.
• 📦 Asegúrate de tener suficiente stock para sostener el crecimiento en la demanda.
```

## Testing

```bash
# Cargar variables de entorno
export $(grep -v '^#' .env | xargs)

# Test via JSON-RPC sobre stdio
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_sales_summary","arguments":{"period":"month"}}}' | node dist/index.js

# O usar MCP Inspector
npm run inspector
```

## Dev Store

- **Dominio:** m25dev.myshopify.com
- **Datos:** 10 productos, 10 clientes, 50 órdenes
- **Revenue total:** ~ARS 995,104
- **Ventana de datos:** 60 días (órdenes redistribuidas con `redistribute-dates.mjs`)

## Autor

**Mauro Venticinque** — Frontend Developer @ VTEX
Challenge Marzo 2026 — Self-Driven Technical Upgrade
