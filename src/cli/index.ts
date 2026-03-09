#!/usr/bin/env node

// CLI entry point
// Supports: install/uninstall --systemd, or default server boot

import { parseInstallArgs } from './install';

// Handle install/uninstall before booting the server
const args = process.argv.slice(2);
if (args.includes('install') || args.includes('uninstall')) {
  parseInstallArgs(args);
} else {
  // Default: boot the server
  await import('../index');
}
