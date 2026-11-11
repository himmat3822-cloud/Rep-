/** @type {import('next').NextConfig} */
const nextConfig = {
  // Type errors must fail the build (v0 had ignoreBuildErrors: true).
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
  poweredByHeader: false,
}

export default nextConfig
