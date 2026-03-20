import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import globals from 'globals';

// Files not included in any tsconfig (tests, config files)
const NON_PROJECT_PATTERNS = [
  '**/*.test.ts',
  '**/*.spec.ts',
  '**/*.config.ts',
  '**/vite.config.ts',
  '**/tsup.config.ts',
  'scripts/**/*.ts',
  'test/**/*.ts',
  'generated/**/*.ts',
];

export default [
  {
    ignores: [
      'dist/**',
      '**/dist/**',
      'coverage/**',
      '.vitest-coverage/**',
      'node_modules/**',
      'packages/**/src/**/*.js',
      'packages/**/src/**/*.js.map',
      'packages/**/src/**/*.d.ts',
      'packages/**/src/**/*.d.ts.map',
      'apps/**/src/**/*.js',
      'apps/**/src/**/*.js.map',
      'apps/**/src/**/*.d.ts',
      'apps/**/src/**/*.d.ts.map',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  // Production TS files — type-aware rules enabled
  {
    files: ['**/*.ts'],
    ignores: NON_PROJECT_PATTERNS,
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['error', 'warn', 'info'] }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
    },
  },
  // Test and config TS files — no type-aware rules (not in tsconfig)
  {
    files: NON_PROJECT_PATTERNS,
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['error', 'warn', 'info'] }],
    },
  },
];
