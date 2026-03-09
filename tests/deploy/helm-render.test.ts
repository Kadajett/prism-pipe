import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const helmDir = resolve(__dirname, '../../deploy/k8s/helm');

describe('Helm chart structure', () => {
  it('has Chart.yaml with required fields', () => {
    const chart = readFileSync(resolve(helmDir, 'Chart.yaml'), 'utf-8');
    expect(chart).toContain('apiVersion: v2');
    expect(chart).toContain('name: prism-pipe');
    expect(chart).toContain('version:');
  });

  it('has values.yaml', () => {
    const values = readFileSync(resolve(helmDir, 'values.yaml'), 'utf-8');
    expect(values).toContain('replicaCount:');
    expect(values).toContain('image:');
    expect(values).toContain('autoscaling:');
    expect(values).toContain('podDisruptionBudget:');
    expect(values).toContain('serviceMonitor:');
  });

  it('has all required templates', () => {
    const templates = readdirSync(resolve(helmDir, 'templates'));
    const required = [
      '_helpers.tpl',
      'deployment.yaml',
      'service.yaml',
      'configmap.yaml',
      'hpa.yaml',
      'pdb.yaml',
      'ingress.yaml',
      'secret.yaml',
      'serviceaccount.yaml',
      'servicemonitor.yaml',
      'pvc.yaml',
    ];
    for (const file of required) {
      expect(templates, `Missing template: ${file}`).toContain(file);
    }
  });

  it('deployment template references health probes', () => {
    const deployment = readFileSync(
      resolve(helmDir, 'templates/deployment.yaml'),
      'utf-8'
    );
    expect(deployment).toContain('livenessProbe');
    expect(deployment).toContain('readinessProbe');
    expect(deployment).toContain('healthCheck.liveness.path');
    expect(deployment).toContain('healthCheck.readiness.path');
  });
});
