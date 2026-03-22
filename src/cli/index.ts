#!/usr/bin/env node

import { createInterface } from 'readline';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` (${defaultValue})` : '';
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

function printBanner() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║       Shopify Insights MCP - Setup           ║');
  console.log('║  Actionable insights for your Shopify store  ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
}

function printClaudeConfig(domain: string, token: string) {
  const isGlobal = process.argv.includes('--global');
  const serverPath = isGlobal
    ? 'shopify-insights-mcp'
    : 'node dist/index.js';

  const config = {
    mcpServers: {
      'shopify-insights': {
        command: isGlobal ? 'npx' : 'node',
        args: isGlobal
          ? ['-y', 'shopify-insights-mcp']
          : ['dist/index.js'],
        env: {
          SHOPIFY_SHOP_DOMAIN: domain,
          SHOPIFY_ACCESS_TOKEN: token,
        },
      },
    },
  };

  console.log('\n📋 Add this to your claude_desktop_config.json:\n');
  console.log(JSON.stringify(config, null, 2));
  console.log('\nConfig file locations:');
  console.log('  macOS: ~/Library/Application Support/Claude/claude_desktop_config.json');
  console.log('  Windows: %APPDATA%\\Claude\\claude_desktop_config.json');
  console.log('  Linux: ~/.config/Claude/claude_desktop_config.json');
}

async function runInit() {
  printBanner();

  console.log('This will configure your Shopify store connection.\n');
  console.log('You need a Custom App with these scopes:');
  console.log('  - read_orders');
  console.log('  - read_products');
  console.log('  - read_customers\n');
  console.log('Create one at: Shopify Admin > Settings > Apps > Develop apps\n');

  const domain = await ask('Shopify store domain (e.g. my-store.myshopify.com)');
  if (!domain) {
    console.error('\nError: Store domain is required.');
    process.exit(1);
  }

  const token = await ask('Access token (starts with shpat_)');
  if (!token) {
    console.error('\nError: Access token is required.');
    process.exit(1);
  }

  const clientId = await ask('Client ID (optional, press Enter to skip)');
  const clientSecret = await ask('Client Secret (optional, press Enter to skip)');

  // Write .env file
  const envPath = join(process.cwd(), '.env');
  const envExists = existsSync(envPath);

  if (envExists) {
    const overwrite = await ask('.env already exists. Overwrite? (y/N)', 'N');
    if (overwrite.toLowerCase() !== 'y') {
      console.log('\nSkipping .env creation.');
      printClaudeConfig(domain, token);
      rl.close();
      return;
    }
  }

  let envContent = `SHOPIFY_SHOP_DOMAIN=${domain}\n`;
  envContent += `SHOPIFY_ACCESS_TOKEN=${token}\n`;
  if (clientId) envContent += `SHOPIFY_CLIENT_ID=${clientId}\n`;
  if (clientSecret) envContent += `SHOPIFY_CLIENT_SECRET=${clientSecret}\n`;

  writeFileSync(envPath, envContent);
  console.log('\n✅ .env file created successfully!');

  // Print Claude Desktop config
  printClaudeConfig(domain, token);

  console.log('\n🚀 Setup complete! Run the server with:');
  console.log('  npm run build && npm start\n');

  rl.close();
}

async function runStart() {
  // Dynamic import to load dotenv and start server
  await import('../index.js');
}

// CLI routing
const command = process.argv[2];

switch (command) {
  case 'init':
  case 'setup':
    runInit().catch((err) => {
      console.error('Setup failed:', err);
      process.exit(1);
    });
    break;

  case 'start':
  case undefined:
    runStart().catch((err) => {
      console.error('Server failed:', err);
      process.exit(1);
    });
    break;

  default:
    console.log('Shopify Insights MCP\n');
    console.log('Usage:');
    console.log('  shopify-insights-mcp init    Configure your Shopify store connection');
    console.log('  shopify-insights-mcp start   Start the MCP server');
    console.log('  shopify-insights-mcp         Start the MCP server (default)');
    break;
}
