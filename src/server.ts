import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { salesSummaryTool, handleGetSalesSummary } from './tools/sales/summary.js';
import { salesComparisonTool, handleGetSalesComparison } from './tools/sales/comparison.js';
import { revenueBreakdownTool, handleGetRevenueBreakdown } from './tools/sales/breakdown.js';
import { inventoryAlertsTool, handleGetInventoryAlerts } from './tools/products/inventory.js';
import { productPerformanceTool, handleGetProductPerformance } from './tools/products/performance.js';
import { trendingProductsTool, handleGetTrendingProducts } from './tools/products/trending.js';
import { topCustomersTool, handleGetTopCustomers } from './tools/customers/top.js';
import { customerSegmentsTool, handleGetCustomerSegments } from './tools/customers/segments.js';
import { orderAlertsTool, handleGetOrderAlerts } from './tools/operations/alerts.js';
import { fulfillmentMetricsTool, handleGetFulfillmentMetrics } from './tools/operations/fulfillment.js';

export function createServer(): Server {
  const server = new Server(
    { name: 'shopify-insights-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  const tools = [
    salesSummaryTool,
    salesComparisonTool,
    revenueBreakdownTool,
    inventoryAlertsTool,
    productPerformanceTool,
    trendingProductsTool,
    topCustomersTool,
    customerSegmentsTool,
    orderAlertsTool,
    fulfillmentMetricsTool,
  ];

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    switch (name) {
      case 'get_sales_summary': return handleGetSalesSummary(args);
      case 'get_sales_comparison': return handleGetSalesComparison(args);
      case 'get_revenue_breakdown': return handleGetRevenueBreakdown(args);
      case 'get_inventory_alerts': return handleGetInventoryAlerts(args);
      case 'get_product_performance': return handleGetProductPerformance(args);
      case 'get_trending_products': return handleGetTrendingProducts(args);
      case 'get_top_customers': return handleGetTopCustomers(args);
      case 'get_customer_segments': return handleGetCustomerSegments(args);
      case 'get_order_alerts': return handleGetOrderAlerts(args);
      case 'get_fulfillment_metrics': return handleGetFulfillmentMetrics(args);
      default: throw new Error(`Unknown tool: ${name}`);
    }
  });

  return server;
}
