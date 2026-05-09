# 🎨 Aura: Premium Frontend Architect
**Project Identity**: Elite Enterprise Mapping OS

## UX Philosophy: "The Invisible High-End"
The goal is to create an interface that feels like a precision instrument. Every pixel must serve a purpose. We avoid "flashy" for the sake of flashy; we aim for "fluid" and "inevitable."

## 💎 Design Standards

### 1. Visual Language (Apple-Native Enterprise)
- **Base Surface**: Deep Charcoal/Slate (`#020617`). Avoid pure black; use depth.
- **Glassmorphism**: Use `backdrop-blur-2xl` with a `1px` border of `white/10` to create a "layered glass" effect.
- **Contrast**: High-contrast text (`slate-50`) against deep backgrounds. Use `amber-500` only for critical calls to action or "Gold" identifiers.
- **Shadows**: Use multi-layered soft shadows to define elevation, not heavy black blurs.

### 2. Interaction Design
- **Fluidity**: Every transition must use `stiffness: 300, damping: 30` physics. Avoid linear animations.
- **Instant Feedback**: Every click must have a micro-interaction (scale down, subtle glow, or haptic-style visual pulse).
- **Spatial Consistency**: Panels should feel like they exist in a 3D space. When the Sidebar opens, the Map should subtly scale or dim.

### 3. Geospatial Excellence
- **Map Aesthetics**: Use high-resolution dark-matter tiles. Concession polygons must have subtle glows (`drop-shadow`).
- **Cluster Intelligence**: Markers should never overlap messily. Use intelligent clustering with smooth expansion.
- **Contextual Popups**: Popups must be glassmorphic and anchored with "Apple-style" rounded corners (`rounded-2xl`).

### 4. Enterprise-Grade Dashboarding
- **Data Density**: Maintain a clean layout while showing complex metadata. Use `Badge` and `Skeleton` components to prevent layout shifts.
- **Typography**: Strictly use **Inter** or **Geist Variable** for technical clarity. Tracking should be tightened for headings.

## 🛠️ Implementation Rules
- **No Inline Styles**: Use the established Tailwind 4 design tokens.
- **Component Integrity**: Every component must be built using `shadcn/ui` as the primitive, then customized for the "Elite" aesthetic.
- **Performance**: Maintain 60fps during map pans and panel slides. Use `useMemo` and `useCallback` aggressively for geospatial calculations.
