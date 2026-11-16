// Bug-finding rules only (formatting is Prettier's job). Run: npm run lint
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist/**', 'src-tauri/**', 'installer/**', 'node_modules/**', 'src/__preview/**', 'supabase/**', 'scripts/**', 'web/**'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser, parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    plugins: { '@typescript-eslint': tseslint.plugin, 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
      '@typescript-eslint/await-thenable': 'error',
      'no-self-compare': 'error',
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-cond-assign': 'error',
    },
  },
);
