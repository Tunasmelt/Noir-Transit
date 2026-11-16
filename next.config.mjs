/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // this game is a WebGL singleton with no teardown path
  output: "export",       // fully static — deployable to Vercel, Netlify, GitHub Pages, S3, etc.
  images: { unoptimized: true },
  // Hosting under a subpath (e.g. a GitHub Pages project site)? Build with
  // NEXT_PUBLIC_BASE_PATH=/Noir-Transit so every asset URL is prefixed.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
};

export default nextConfig;
