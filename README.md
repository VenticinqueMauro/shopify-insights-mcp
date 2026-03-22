# Shopify Insights MCP

> MCP Server for Shopify that delivers actionable business insights — comparisons, alerts, and recommendations, not just numbers.

## Demo

https://github.com/user-attachments/assets/7aec6034-16fc-4fc8-9427-331f00d13430

## Why This Exists

Existing Shopify MCP servers return raw data. Shopify Insights MCP answers **"what does it mean?"** and **"what should I do?"**:

| Other MCPs | Shopify Insights MCP |
|-----------|---------------------|
| "You have $45,000 in sales" | "You have $45,000, **12% less** than last month" |
| "List of 50 products" | "5 products have **critical stock** and high demand" |
| "10 pending orders" | "3 orders have been **unfulfilled for 5+ days**" |

## Stack

- **TypeScript** + **MCP SDK** (`@modelcontextprotocol/sdk`)
- **Shopify Admin API** (GraphQL)
- **Zod** for input validation
- Transport: **stdio**

## Installation

### Option A: npm (recommended)

```bash
npm install -g shopify-insights-mcp
shopify-insights-mcp init
```

The `init` command will guide you through connecting your Shopify store and generate the Claude Desktop configuration.

### Option B: From source

```bash
git clone https://github.com/VenticinqueMauro/shopify-insights-mcp.git
cd shopify-insights-mcp
npm install
npm run build
npm run setup       # Guided configuration
```

### Shopify App Requirements

You need a **Custom App** with these scopes:
- `read_orders`, `read_products`, `read_customers`

Create one at: **Shopify Admin > Settings > Apps and sales channels > Develop apps**

### Build & Run

```bash
npm run build       # Compile TypeScript → dist/
npm start           # Run the MCP server (stdio)
npm run setup       # Guided setup wizard
npm run inspector   # Open MCP Inspector for debugging
```

## Usage with Claude Desktop

### Quick setup (via npx)

```json
{
  "mcpServers": {
    "shopify-insights": {
      "command": "npx",
      "args": ["-y", "shopify-insights-mcp"],
      "env": {
        "SHOPIFY_SHOP_DOMAIN": "your-store.myshopify.com",
        "SHOPIFY_ACCESS_TOKEN": "shpat_your_token"
      }
    }
  }
}
```

### Local install

```json
{
  "mcpServers": {
    "shopify-insights": {
      "command": "node",
      "args": ["/path/to/shopify-insights-mcp/dist/index.js"],
      "env": {
        "SHOPIFY_SHOP_DOMAIN": "your-store.myshopify.com",
        "SHOPIFY_ACCESS_TOKEN": "shpat_your_token"
      }
    }
  }
}
```

> Run `shopify-insights-mcp init` to generate this config automatically.

Then ask Claude things like:
- *"How are sales this month compared to last month?"*
- *"Which products are trending up?"*
- *"Are there any orders that need urgent attention?"*
- *"How are my customers segmented?"*

## Tools (10)

### Sales & Revenue

| Tool | Description |
|------|-------------|
| `get_sales_summary` | Sales summary with period-over-period comparison. Revenue, orders, AOV, units sold |
| `get_sales_comparison` | Side-by-side comparison of two custom date ranges |
| `get_revenue_breakdown` | Revenue broken down by product, vendor, or product type |

### Products & Inventory

| Tool | Description |
|------|-------------|
| `get_product_performance` | Product ranking by revenue, units sold, or order count |
| `get_inventory_alerts` | Stock alerts: out-of-stock, low stock, overstock detection |
| `get_trending_products` | Trending products (rising/falling) vs. previous period |

### Customers

| Tool | Description |
|------|-------------|
| `get_customer_segments` | Automatic segmentation: VIP, Loyal, Returning, New, Inactive |
| `get_top_customers` | Customer ranking by total spend or order count |

### Operations

| Tool | Description |
|------|-------------|
| `get_order_alerts` | Orders needing attention: delayed fulfillment, financial issues, high-value pending |
| `get_fulfillment_metrics` | Operational metrics: fulfillment rate, financial status, health score |

## Architecture

```
src/
├── index.ts                  # Entry point
├── server.ts                 # Tool registration & request handler
├── shopify/
│   ├── auth.ts               # Credentials from env vars
│   ├── client.ts             # GraphQL wrapper
│   └── queries/              # Orders, products, customers queries
├── tools/
│   ├── sales/                # 3 sales tools
│   ├── products/             # 3 product tools
│   ├── customers/            # 2 customer tools
│   └── operations/           # 2 operations tools
├── analytics/
│   ├── comparisons.ts        # Change calculation (%, direction)
│   ├── insights.ts           # Automatic insight generation
│   └── recommendations.ts    # Actionable recommendations
├── types/
│   └── shopify.ts            # Shared GraphQL types
└── utils/
    ├── dates.ts              # Period handling & date formatting
    ├── formatting.ts         # Currency, percentage, number formatting
    └── errors.ts             # Standard error handling
```

## Example Output

```
📊 SALES SUMMARY - THIS MONTH

CURRENT METRICS:
• Revenue: $1,245,000.00
• Orders: 234
• Avg Order Value: $5,320.51
• Units Sold: 892

VS. PREVIOUS MONTH:
• Revenue: +18.0% (+$190,000.00)
• Orders: +12.0% (+25)
• Avg Order Value: +5.4% (+$272.00)

💡 INSIGHTS:
• 📈 Revenue grew 18.0% compared to the previous period.
• 🛒 Order volume increased 12.0% (+25 orders).

📋 RECOMMENDATIONS:
• 🚀 Leverage the positive momentum by increasing investment in top-performing channels.
• 📦 Ensure sufficient stock to sustain demand growth.
```

## Testing

```bash
# Load environment variables
export $(grep -v '^#' .env | xargs)

# Test via JSON-RPC over stdio
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_sales_summary","arguments":{"period":"month"}}}' | node dist/index.js

# Or use MCP Inspector
npm run inspector
```

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

## License

MIT
