// Shared Shopify GraphQL response types

export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface ShopifyMoney {
  amount: string;
  currencyCode: string;
}

export interface ShopifyLineItem {
  node: {
    quantity: number;
    originalUnitPriceSet: { shopMoney: ShopifyMoney };
    product: {
      id: string;
      title: string;
      vendor: string;
      productType: string;
    } | null;
  };
}

export interface ShopifyOrder {
  node: {
    id: string;
    name: string;
    processedAt: string;
    totalPriceSet: { shopMoney: ShopifyMoney };
    lineItems: { edges: ShopifyLineItem[] };
    displayFinancialStatus: string;
    displayFulfillmentStatus: string | null;
    customer?: { id: string } | null;
  };
}

export interface OrdersQueryResult {
  orders: { edges: ShopifyOrder[]; pageInfo: PageInfo };
}

export interface ShopifyVariant {
  node: {
    id: string;
    title: string;
    price: string;
    inventoryQuantity: number;
  };
}

export interface ShopifyProduct {
  node: {
    id: string;
    title: string;
    vendor: string;
    productType: string;
    status: string;
    variants: { edges: ShopifyVariant[] };
  };
}

export interface ProductsQueryResult {
  products: { edges: ShopifyProduct[]; pageInfo: PageInfo };
}

export interface ShopifyCustomer {
  node: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    createdAt: string;
    numberOfOrders: string;
    amountSpent: ShopifyMoney;
  };
}

export interface CustomersQueryResult {
  customers: { edges: ShopifyCustomer[]; pageInfo: PageInfo };
}

export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

export interface ShopContext {
  currencyCode: string;
  ianaTimezone: string;
}
