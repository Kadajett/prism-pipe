/**
 * systemd service installer for prism-pipe
 *
 * Usage:
 *   prism-pipe install --systemd [--user <user>] [--working-dir <dir>] [--env-file <path>] [--restart <policy>]
 *   prism-pipe uninstall --systemd
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVICE_NAME = 'prism-pipe';
const SERVICE_PATH = `/etc/systemd/system/${SERVICE_NAME}.service`;

interface InstallOptions {
  user: string;
  workingDir: string;
  envFile: string;
  restartPolicy: string;
}

function getTemplatePath(): string {
  // Look for template relative to project root
  const candidates = [
    resolve(__dirname, '../../deploy/systemd/prism-pipe.service.template'),
    resolve(__dirname, '../deploy/systemd/prism-pipe.service.template'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Service template not found. Searched:\n${candidates.join('\n')}`
  );
}

function renderTemplate(options: InstallOptions): string {
  const template = readFileSync(getTemplatePath(), 'utf-8');
  return template
    .replaceAll('{{USER}}', options.user)
    .replaceAll('{{WORKING_DIR}}', options.workingDir)
    .replaceAll('{{ENV_FILE}}', options.envFile)
    .replaceAll('{{RESTART_POLICY}}', options.restartPolicy);
}

export function installSystemd(options: Partial<InstallOptions> = {}): void {
  const resolved: InstallOptions = {
    user: options.user || process.env.USER || 'prism-pipe',
    workingDir: options.workingDir || process.cwd(),
    envFile: options.envFile || '/etc/prism-pipe/env',
    restartPolicy: options.restartPolicy || 'on-failure',
  };

  console.log(`Installing ${SERVICE_NAME} systemd service...`);
  console.log(`  User:        ${resolved.user}`);
  console.log(`  Working dir: ${resolved.workingDir}`);
  console.log(`  Env file:    ${resolved.envFile}`);
  console.log(`  Restart:     ${resolved.restartPolicy}`);

  const serviceContent = renderTemplate(resolved);

  try {
    writeFileSync(SERVICE_PATH, serviceContent, { mode: 0o644 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('EACCES') || msg.includes('permission denied')) {
      console.error(
        `\nPermission denied. Run with sudo:\n  sudo prism-pipe install --systemd`
      );
      process.exit(1);
    }
    throw err;
  }

  execSync('systemctl daemon-reload', { stdio: 'inherit' });
  execSync(`systemctl enable ${SERVICE_NAME}`, { stdio: 'inherit' });
  execSync(`systemctl start ${SERVICE_NAME}`, { stdio: 'inherit' });

  console.log(`\n✅ ${SERVICE_NAME} installed and started.`);
  console.log(`   Status: systemctl status ${SERVICE_NAME}`);
  console.log(`   Logs:   journalctl -u ${SERVICE_NAME} -f`);
}

export function uninstallSystemd(): void {
  console.log(`Removing ${SERVICE_NAME} systemd service...`);

  try {
    execSync(`systemctl stop ${SERVICE_NAME}`, { stdio: 'inherit' });
  } catch {
    // Service might not be running
  }

  try {
    execSync(`systemctl disable ${SERVICE_NAME}`, { stdio: 'inherit' });
  } catch {
    // Service might not be enabled
  }

  if (existsSync(SERVICE_PATH)) {
    unlinkSync(SERVICE_PATH);
  }

  execSync('systemctl daemon-reload', { stdio: 'inherit' });

  console.log(`\n✅ ${SERVICE_NAME} removed.`);
}

// CLI argument parsing
export function parseInstallArgs(args: string[]): void {
  const isInstall = args.includes('install');
  const isUninstall = args.includes('uninstall');
  const isSystemd = args.includes('--systemd');

  if (!isSystemd) return;

  if (isUninstall) {
    uninstallSystemd();
    process.exit(0);
  }

  if (isInstall) {
    const getArg = (flag: string): string | undefined => {
      const idx = args.indexOf(flag);
      return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
    };

    installSystemd({
      user: getArg('--user'),
      workingDir: getArg('--working-dir'),
      envFile: getArg('--env-file'),
      restartPolicy: getArg('--restart'),
    });
    process.exit(0);
  }
}
