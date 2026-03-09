import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatePath = resolve(__dirname, '../../deploy/systemd/prism-pipe.service.template');

describe('systemd service template', () => {
  const template = readFileSync(templatePath, 'utf-8');

  it('has required systemd sections', () => {
    expect(template).toContain('[Unit]');
    expect(template).toContain('[Service]');
    expect(template).toContain('[Install]');
  });

  it('has required placeholders', () => {
    expect(template).toContain('{{USER}}');
    expect(template).toContain('{{WORKING_DIR}}');
    expect(template).toContain('{{ENV_FILE}}');
    expect(template).toContain('{{RESTART_POLICY}}');
  });

  it('uses ExecStart with node', () => {
    expect(template).toContain('ExecStart=');
    expect(template).toContain('node');
  });

  it('includes security hardening', () => {
    expect(template).toContain('NoNewPrivileges=true');
    expect(template).toContain('ProtectSystem=strict');
  });

  it('renders correctly with substitutions', () => {
    const rendered = template
      .replaceAll('{{USER}}', 'testuser')
      .replaceAll('{{WORKING_DIR}}', '/opt/prism-pipe')
      .replaceAll('{{ENV_FILE}}', '/etc/prism-pipe/env')
      .replaceAll('{{RESTART_POLICY}}', 'always');

    expect(rendered).toContain('User=testuser');
    expect(rendered).toContain('WorkingDirectory=/opt/prism-pipe');
    expect(rendered).not.toContain('{{');
  });
});
