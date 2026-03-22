import { z } from 'zod';
import { fetchAllPages } from '../../shopify/client.js';
import { PRODUCTS_QUERY } from '../../shopify/queries/products.js';
import { formatNumber } from '../../utils/formatting.js';
import { handleToolError } from '../../utils/errors.js';
import type { ProductsQueryResult, ToolResult } from '../../types/shopify.js';

export const inventoryAlertsTool = {
  name: 'get_inventory_alerts',
  description:
    'Check inventory levels across all products. Identifies out-of-stock and low-stock variants that need attention.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      low_stock_threshold: {
        type: 'number',
        description: 'Units at or below this number are considered low stock (default: 5)',
        default: 5,
      },
      include_out_of_stock: {
        type: 'boolean',
        description: 'Include variants with zero inventory (default: true)',
        default: true,
      },
    },
    required: [],
  },
};

const InventorySchema = z.object({
  low_stock_threshold: z.number().int().min(1).default(5),
  include_out_of_stock: z.boolean().default(true),
});

interface VariantAlert {
  productTitle: string;
  variantTitle: string;
  quantity: number;
  status: 'out_of_stock' | 'low_stock';
}

export async function handleGetInventoryAlerts(args: unknown): Promise<ToolResult> {
  try {
    const { low_stock_threshold, include_out_of_stock } = InventorySchema.parse(args);

    const { edges: products, truncated } = await fetchAllPages(
      PRODUCTS_QUERY,
      {},
      (data) => (data as ProductsQueryResult).products
    );

    const outOfStock: VariantAlert[] = [];
    const lowStock: VariantAlert[] = [];
    let totalVariants = 0;
    let healthyCount = 0;

    for (const { node: product } of products) {
      if (product.status !== 'ACTIVE') continue;

      for (const { node: variant } of product.variants.edges) {
        totalVariants++;
        const qty = variant.inventoryQuantity ?? 0;

        if (qty <= 0) {
          outOfStock.push({
            productTitle: product.title,
            variantTitle: variant.title,
            quantity: qty,
            status: 'out_of_stock',
          });
        } else if (qty <= low_stock_threshold) {
          lowStock.push({
            productTitle: product.title,
            variantTitle: variant.title,
            quantity: qty,
            status: 'low_stock',
          });
        } else {
          healthyCount++;
        }
      }
    }

    // Sort by quantity ascending (most urgent first)
    outOfStock.sort((a, b) => a.quantity - b.quantity);
    lowStock.sort((a, b) => a.quantity - b.quantity);

    const sep = '─'.repeat(70);
    let text = `🚨 INVENTORY ALERTS\n\n`;
    text += `Low stock threshold: ≤ ${low_stock_threshold} units\n`;
    text += `Total active variants: ${formatNumber(totalVariants)}\n\n`;

    // Summary counts
    text += `${sep}\n`;
    text += `  🔴 Out of stock:  ${formatNumber(outOfStock.length)} variants\n`;
    text += `  🟡 Low stock:     ${formatNumber(lowStock.length)} variants\n`;
    text += `  🟢 Healthy stock: ${formatNumber(healthyCount)} variants\n`;
    text += `${sep}\n`;

    // Out of stock detail
    if (include_out_of_stock && outOfStock.length > 0) {
      text += `\n🔴 OUT OF STOCK (${outOfStock.length})\n\n`;
      for (const v of outOfStock) {
        const variant = v.variantTitle !== 'Default Title' ? ` (${v.variantTitle})` : '';
        text += `  • ${v.productTitle}${variant} — ${v.quantity} units\n`;
      }
    }

    // Low stock detail
    if (lowStock.length > 0) {
      text += `\n🟡 LOW STOCK (${lowStock.length})\n\n`;
      for (const v of lowStock) {
        const variant = v.variantTitle !== 'Default Title' ? ` (${v.variantTitle})` : '';
        text += `  • ${v.productTitle}${variant} — ${v.quantity} units\n`;
      }
    }

    // Insights
    const alertCount = outOfStock.length + lowStock.length;
    if (alertCount === 0) {
      text += `\n💡 All products have healthy stock levels. No action required.\n`;
    } else {
      const pct = ((alertCount / totalVariants) * 100).toFixed(1);
      text += `\n💡 ${pct}% of variants require restocking attention.\n`;
      if (outOfStock.length > 0) {
        text += `💡 Priority: restock ${outOfStock.length} out-of-stock variant(s) to avoid lost sales.\n`;
      }
    }

    if (truncated) {
      text += '\n⚠️ Results limited to configured maximum records. Store may have more data. Increase SHOPIFY_MAX_RECORDS to fetch more.\n';
    }

    return { content: [{ type: 'text', text }] };
  } catch (error) {
    return handleToolError(error);
  }
}
