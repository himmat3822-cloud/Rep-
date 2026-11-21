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
  experimental: {
    // Pages you just visited reopen instantly for 30 seconds (going back and
    // forth between Overview and Attendance). Saves call router.refresh(),
    // which clears this cache, so data never lags behind your own changes.
    staleTimes: { dynamic: 30 },
  },
}

export default nextConfig
