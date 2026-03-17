/**
 * Factory for creating email provider adapters.
 * Routes to the correct adapter based on connection providerKind.
 */

import type { EmailProviderAdapter } from './adapter-interface.js';
import { GwsCliAdapter, type GwsCliAdapterConfig } from './gws-adapter.js';
import { ProtonBridgeAdapter, type ProtonBridgeAdapterConfig } from './proton-adapter.js';

export interface AdapterCredentials {
  /** Proton Bridge username (email address). */
  username?: string | undefined;
  /** Proton Bridge IMAP password (bridge-generated). */
  password?: string | undefined;
  /** Path to gws binary. */
  gwsPath?: string | undefined;
}

export function createAdapter(
  providerKind: 'gmail' | 'proton',
  credentials: AdapterCredentials = {},
): EmailProviderAdapter {
  switch (providerKind) {
    case 'gmail':
      // gws manages its own auth — no credentials needed from Popeye
      return new GwsCliAdapter({
        gwsPath: credentials.gwsPath,
      } satisfies GwsCliAdapterConfig);

    case 'proton': {
      if (!credentials.username || !credentials.password) {
        throw new Error('Proton Bridge adapter requires username and password');
      }
      return new ProtonBridgeAdapter({
        username: credentials.username,
        password: credentials.password,
      } satisfies ProtonBridgeAdapterConfig);
    }
  }
}
