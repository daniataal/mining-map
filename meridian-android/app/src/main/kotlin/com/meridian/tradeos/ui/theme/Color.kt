package com.meridian.tradeos.ui.theme

import androidx.compose.ui.graphics.Color

// ── Background layers ──────────────────────────────────────────────────────
val BackgroundDeep    = Color(0xFF080C14)
val BackgroundBase    = Color(0xFF0D1220)
val SurfaceElevated   = Color(0xFF141927)
val SurfaceSheet      = Color(0xFF1A2134)

// ── Glass / frost surfaces ─────────────────────────────────────────────────
val GlassSurface      = Color(0x0FFFFFFF)   // ~6 % white
val GlassBorder       = Color(0x26FFFFFF)   // ~15 % white
val GlassBorderSubtle = Color(0x0DFFFFFF)   // ~5 % white
val GlassHighlight    = Color(0x1AFFFFFF)   // ~10 % white — top-edge sheen

// ── Accent — cyan (nautical / chart) + amber (commodities) ────────────────
val AccentCyan     = Color(0xFF00E5FF)
val AccentCyanDim  = Color(0x9900E5FF)
val AccentAmber    = Color(0xFFF5A623)
val AccentGold     = Color(0xFFFFD166)
val AccentAmberDim = Color(0x99F5A623)      // 60 % amber
val AccentGlow     = Color(0x33F5A623)      // 20 % amber — halo
val AccentGlowFade = Color(0x00F5A623)      // transparent amber — gradient tail

// ── Text ──────────────────────────────────────────────────────────────────
val TextPrimary   = Color(0xFFF0F4FF)
val TextSecondary = Color(0xFFADB8CC)
val TextMuted     = Color(0xFF6B7899)
val TextOnAccent  = Color(0xFF180A00)

// ── Tile gradients ─────────────────────────────────────────────────────────
val TileMiningStart     = Color(0xFF1B3A5C)
val TileMiningEnd       = Color(0xFF0A1E35)
val TileOilStart        = Color(0xFF3D2900)
val TileOilEnd          = Color(0xFF1A1200)
val TileLogisticsStart  = Color(0xFF1A3020)
val TileLogisticsEnd    = Color(0xFF0D1A10)
val TileMarketsStart    = Color(0xFF1A1A38)
val TileMarketsEnd      = Color(0xFF0D0D1E)

// ── Mesh gradient nodes ────────────────────────────────────────────────────
val MeshBlueDeep   = Color(0xFF080F2E)
val MeshPurpleDeep = Color(0xFF14082E)
val MeshAmberHint  = Color(0x14F5A623)      // subtle warm accent in mesh

// ── Status ─────────────────────────────────────────────────────────────────
val StatusActive  = Color(0xFF4CAF50)
val StatusAmber   = Color(0xFFF5A623)
val StatusError   = Color(0xFFEF5350)
