import type {
  AppConfig,
  ProviderAuthConfigListResponse,
  ProviderAuthConfigRecord,
  ProviderAuthConfigUpdateInput,
  ProviderAuthProvider,
} from '@popeye/contracts';
import {
  RuntimeValidationError,
  loadProviderAuthConfigFromFile,
  updateProviderAuthConfigFile,
  type PopeyeRuntimeService,
} from '@popeye/runtime-core';

export interface ProviderAuthConfigUpdateResult {
  snapshot: ProviderAuthConfigListResponse;
  record: ProviderAuthConfigRecord;
  changedFields: Array<'clientId' | 'clientSecretRefId'>;
}

export class ProviderAuthControlPlane {
  constructor(
    private readonly configPath: string,
    _initialConfig: AppConfig,
    private readonly runtime: Pick<PopeyeRuntimeService, 'getSecretValue' | 'setSecret' | 'deleteSecret' | 'applyProviderAuthConfig'>,
  ) {}

  getSnapshot(): ProviderAuthConfigListResponse {
    return loadProviderAuthConfigFromFile(this.configPath, (id) => this.runtime.getSecretValue(id));
  }

  updateConfig(provider: ProviderAuthProvider, input: ProviderAuthConfigUpdateInput): ProviderAuthConfigUpdateResult {
    const snapshotBefore = this.getSnapshot();
    const previous = this.requireRecord(snapshotBefore, provider);
    const normalizedClientId = normalizeOptionalString(input.clientId);
    const normalizedClientSecret = normalizeOptionalString(input.clientSecret);

    if (input.clearStoredSecret && normalizedClientSecret) {
      throw new RuntimeValidationError('clientSecret and clearStoredSecret cannot be provided together');
    }

    let createdSecretId: string | null = null;

    try {
      const nextClientId = input.clientId === undefined ? previous.clientId : normalizedClientId ?? null;
      let nextSecretRefId = previous.clientSecretRefId;

      if (input.clearStoredSecret) {
        nextSecretRefId = null;
      } else if (normalizedClientSecret) {
        const secret = this.runtime.setSecret({
          key: `oauth-client-secret-${provider}`,
          value: normalizedClientSecret,
          description: `${providerDisplayName(provider)} OAuth client secret`,
        });
        createdSecretId = secret.id;
        nextSecretRefId = secret.id;
      }

      const result = updateProviderAuthConfigFile(
        this.configPath,
        provider,
        {
          clientId: nextClientId,
          clientSecretRefId: nextSecretRefId,
        },
        (id) => this.runtime.getSecretValue(id),
      );
      this.runtime.applyProviderAuthConfig(provider, {
        clientId: result.record.clientId,
        clientSecretRefId: result.record.clientSecretRefId,
      });

      if (
        result.previousSecretRefId
        && result.previousSecretRefId != result.record.clientSecretRefId
      ) {
        this.runtime.deleteSecret(result.previousSecretRefId);
      }

      return {
        snapshot: this.getSnapshot(),
        record: result.record,
        changedFields: result.changedFields,
      };
    } catch (error) {
      if (createdSecretId) {
        this.runtime.deleteSecret(createdSecretId);
      }
      throw error;
    }
  }

  private requireRecord(snapshot: ProviderAuthConfigListResponse, provider: ProviderAuthProvider): ProviderAuthConfigRecord {
    const record = snapshot.find((entry) => entry.provider == provider);
    if (!record) {
      throw new RuntimeValidationError(`Provider auth record not found for ${provider}`);
    }
    return record;
  }
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function providerDisplayName(provider: ProviderAuthProvider): string {
  switch (provider) {
    case 'google':
      return 'Google';
    case 'github':
      return 'GitHub';
  }
}
