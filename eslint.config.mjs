import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'

/**
 * Next.js 16 removed `next lint`. Use the ESLint CLI + flat config instead.
 * See: https://nextjs.org/docs/app/api-reference/config/eslint
 *
 * Newer react-hooks rules (React Compiler / React 19) are off by default here
 * so existing app code is not forced to change for a tooling migration.
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  {
    rules: {
      // Not previously enforced by classic next lint — keep off for this migration
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      // Pre-existing findings: report without failing CI until cleaned up separately
      'react/no-unescaped-entities': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      '@next/next/no-html-link-for-pages': 'warn',
      '@next/next/no-assign-module-variable': 'warn',
      '@next/next/no-location-assign-relative-destination': 'warn',
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'node_modules/**',
  ]),
])

export default eslintConfig
