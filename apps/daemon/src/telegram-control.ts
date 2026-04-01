import type {
  AppConfig,
  TelegramApplyResponse,
  TelegramConfigSnapshot,
  TelegramConfigUpdateInput,
  TelegramManagementMode,
  TelegramSecretAvailability,
} from '@popeye/contracts';
import {
  RuntimeConflictError,
  RuntimeValidationError,
  loadAppConfig,
  restartLaunchAgent,
  toTelegramConfigRecord,
  updateTelegramConfigFile,
  type PopeyeRuntimeService,
} from '@popeye/runtime-core';
import { createLogger, redactText } from '@popeye/observability';

import { resolveTelegramWorkspaceId, startTelegramBridge, type StartedTelegramBridge, type TelegramBridgeDeps } from './telegram-bridge.js';

export interface TelegramConfigUpdateResult {
  snapshot: TelegramConfigSnapshot;
  changedFields: Array<'enabled' | 'allowedUserId' | 'secretRefId'>;
}

export class TelegramControlPlane {
  private currentConfig: AppConfig;
  private currentBridge: StartedTelegramBridge | null = null;
  private readonly log;
  private readonly launchdLabel: string | null;
  private readonly bridgeDeps: TelegramBridgeDeps;

  constructor(
    private readonly configPath: string,
    initialConfig: AppConfig,
    private readonly runtime: Pick<PopeyeRuntimeService, 'getSecretValue'>,
  ) {
    this.currentConfig = initialConfig;
    this.bridgeDeps = {
      getSecretValue: (id) => this.runtime.getSecretValue(id),
    };
    this.log = createLogger('telegram-control', initialConfig.security.redactionPatterns);
    const label = process.env.POPEYE_LAUNCHD_LABEL?.trim();
    this.launchdLabel = label && label.length > 0 ? label : null;
  }

  async startInitialBridge(): Promise<StartedTelegramBridge | null> {
    const bridge = await startTelegramBridge(this.currentConfig, this.bridgeDeps);
    this.currentBridge = bridge;
    return bridge;
  }

  async stopCurrentBridge(): Promise<void> {
    await this.currentBridge?.stop();
    this.currentBridge = null;
  }

  getSnapshot(): TelegramConfigSnapshot {
    const persistedConfig = loadAppConfig(this.configPath);
    const persisted = toTelegramConfigRecord(persistedConfig);
    const applied = toTelegramConfigRecord(this.currentConfig);
    const secretAvailability = this.resolveSecretAvailability(persisted.secretRefId);
    const staleComparedToApplied = JSON.stringify(persisted) !== JSON.stringify(applied);
    return {
      persisted,
      applied,
      effectiveWorkspaceId: resolveTelegramWorkspaceId(persistedConfig),
      secretAvailability,
      staleComparedToApplied,
      warnings: this.buildWarnings({
        persisted,
        applied,
        secretAvailability,
        staleComparedToApplied,
        hasEnvironmentToken: Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim()),
      }),
      managementMode: this.managementMode,
      restartSupported: this.restartSupported,
    };
  }

  updateConfig(input: TelegramConfigUpdateInput): TelegramConfigUpdateResult {
    const result = updateTelegramConfigFile(this.configPath, input);
    return {
      snapshot: this.getSnapshot(),
      changedFields: result.changedFields,
    };
  }

  async applyTelegramConfig(): Promise<TelegramApplyResponse> {
    const previousConfig = this.currentConfig;
    const previousBridge = this.currentBridge;

    try {
      if (this.currentBridge) {
        await this.currentBridge.stop();
        this.currentBridge = null;
      }

      const nextConfig = loadAppConfig(this.configPath);
      const nextBridge = await startTelegramBridge(nextConfig, this.bridgeDeps);
      this.currentConfig = nextConfig;
      this.currentBridge = nextBridge;

      const snapshot = this.getSnapshot();
      if (!nextConfig.telegram.enabled) {
        return {
          status: 'disabled',
          summary: 'Telegram is disabled in persisted config. The bridge is now stopped.',
          snapshot,
        };
      }
      if (nextBridge) {
        return {
          status: 'reloaded_active',
          summary: 'Telegram bridge reloaded and is active.',
          snapshot,
        };
      }
      return {
        status: 'reloaded_inactive',
        summary: 'Telegram config was applied, but the bridge is inactive until token/config requirements are satisfied.',
        snapshot,
      };
    } catch (error) {
      const detail = this.redactError(error);
      this.log.error('telegram apply failed', { detail });
      try {
        const rollbackBridge = await startTelegramBridge(previousConfig, this.bridgeDeps);
        this.currentConfig = previousConfig;
        this.currentBridge = rollbackBridge;
        return {
          status: 'failed_rolled_back',
          summary: `Telegram apply failed; previous bridge state was restored. ${detail}`,
          snapshot: this.getSnapshot(),
        };
      } catch (rollbackError) {
        this.currentConfig = previousConfig;
        this.currentBridge = null;
        const rollbackDetail = this.redactError(rollbackError);
        this.log.error('telegram apply rollback failed', { detail: rollbackDetail });
        return {
          status: 'failed_stopped',
          summary: `Telegram apply failed and rollback could not restore the previous bridge. ${detail}`,
          snapshot: this.getSnapshot(),
        };
      }
    } finally {
      void previousBridge;
    }
  }

  get managementMode(): TelegramManagementMode {
    return this.launchdLabel ? 'launchd' : 'manual';
  }

  get restartSupported(): boolean {
    return this.launchdLabel !== null;
  }

  restartDaemonNow(): { ok: boolean; output: string } {
    if (!this.launchdLabel) {
      return { ok: false, output: 'launchd-managed restart is unavailable for this daemon process' };
    }
    return restartLaunchAgent(this.launchdLabel);
  }

  private resolveSecretAvailability(secretRefId: string | null): TelegramSecretAvailability {
    if (!secretRefId) {
      return 'not_configured';
    }
    return this.runtime.getSecretValue(secretRefId) ? 'available' : 'missing';
  }

  private buildWarnings(input: {
    persisted: ReturnType<typeof toTelegramConfigRecord>;
    applied: ReturnType<typeof toTelegramConfigRecord>;
    secretAvailability: TelegramSecretAvailability;
    staleComparedToApplied: boolean;
    hasEnvironmentToken: boolean;
  }): string[] {
    const warnings: string[] = [];
    if (input.persisted.enabled && !input.persisted.allowedUserId) {
      warnings.push('Telegram is enabled, but allowed user ID is still missing.');
    }
    if (input.persisted.enabled && !input.hasEnvironmentToken) {
      if (!input.persisted.secretRefId) {
        warnings.push('Telegram is enabled, but no bot token reference is configured yet.');
      } else if (input.secretAvailability === 'missing') {
        warnings.push('Telegram secret reference is configured, but the secret is not currently available.');
      }
    }
    if (input.staleComparedToApplied) {
      warnings.push('Saved Telegram settings differ from the daemon-applied settings. Apply or restart the daemon to use the latest config.');
    }
    if (input.applied.enabled && !input.persisted.enabled && !input.staleComparedToApplied) {
      warnings.push('Telegram is disabled in config, but the daemon still reports it as applied; restart if the bridge remains visible.');
    }
    return warnings;
  }

  private redactError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return redactText(message, this.currentConfig.security.redactionPatterns).text;
  }
}

export function classifyTelegramConfigError(error: unknown): 'conflict' | 'validation' | 'unknown' {
  if (error instanceof RuntimeConflictError) return 'conflict';
  if (error instanceof RuntimeValidationError) return 'validation';
  return 'unknown';
}
