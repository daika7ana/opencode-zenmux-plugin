import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['src/**/*.ts'],
  },
  {
    ignores: ['dist/', 'node_modules/', '*.d.ts', '**/*.d.ts'],
  }
)
