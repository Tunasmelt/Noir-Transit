/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // this game is a WebGL singleton with no teardown path
  output: "export",       // fully static — deployable to Vercel, Netlify, GitHub Pages, S3, etc.
  images: { unoptimized: true },
};

export default nextConfig;
