import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

/**
 * Lint config.
 *
 * Deliberately narrow: type-checking is `tsc`'s job and formatting is nobody's
 * (there is no Prettier here), so this covers the class of bug review keeps
 * having to catch by eye — stale hook dependencies above all, which is what
 * shipped the `?player=` framing bug and is invisible to both the compiler and
 * the unit tests.
 */
export default tseslint.config(
  { ignores: ['dist', 'web/public/v1', 'node_modules', 'coverage'] },

  // --- browser code --------------------------------------------------------
  {
    files: ['web/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The one that matters most here: an effect reading state it doesn't
      // list runs against a stale value, which no test and no type will catch.
      'react-hooks/exhaustive-deps': 'error',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Prefixing with _ is the established way to say "deliberately unused".
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // --- ingest (Node) -------------------------------------------------------
  {
    files: ['ingest/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // --- tests ---------------------------------------------------------------
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
