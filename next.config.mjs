/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pg", "@aws-sdk/dsql-signer"],
};

export default nextConfig;
