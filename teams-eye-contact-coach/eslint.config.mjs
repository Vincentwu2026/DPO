import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/.venv/**', '**/__pycache__/**']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['electron/src/main/**/*.ts', 'electron/src/preload/**/*.ts', 'electron/*.ts'],
    languageOptions: { globals: globals.node }
  },
  {
    files: ['electron/src/renderer/**/*.ts'],
    languageOptions: { globals: globals.browser }
  },
  {
    files: ['scripts/**/*.mjs', '*.mjs', 'electron/src/**/fixtures/*.mjs'],
    languageOptions: { globals: globals.node }
  },
  prettier
)
