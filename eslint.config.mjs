import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

const eslintConfig = [
  {
    ignores: [".next/**", "node_modules/**", "sdk/dist/**", "next-env.d.ts", "*.tsbuildinfo"],
  },
  ...coreWebVitals,
  ...typescript,
  prettier,
];

export default eslintConfig;
