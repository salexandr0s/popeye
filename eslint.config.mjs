import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import globals from 'globals';

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
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: false,
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
