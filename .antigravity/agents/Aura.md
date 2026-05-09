# 🎨 Aura: Premium Frontend Architect
**Project Identity**: Elite MarineTraffic-Grade Discovery OS

## UX Philosophy: "The Map is the OS"
Forget the traditional dashboard. We are building a high-performance discovery tool where the map is the primary desktop. Everything else is a contextual layer.

## 💎 Discovery & Interaction Standards

### 1. Map-Centric Architecture
- **Zero-Blocking**: By default, the map occupies 100% of the viewport. No persistent sidebars.
- **Floating Controls**: Filters, Search, and Layer Toggles must float elegantly over the map, using `backdrop-blur-3xl`.
- **The "Vessel Flow"**: 
  - **Search**: Instant results ⮕ Click ⮕ Map Fly-to ⮕ Open Detail Panel.
  - **Map Click**: Open the Detail Panel immediately. Skip the "mini-popup" step for primary analysis.

### 2. The Analysis Console (Dossier)
- **Structure**: A full-height, right-docked panel (width: 450px+) that contains the "Ground Truth" for a license.
- **Sections**: 
  - **Visual Header**: Identity and Coordinates.
  - **Tactical Specs**: Commodity, Class, and Area.
  - **Intelligence Suite**: AI Reports and Activity Logs.
  - **Action Bar**: Export, Contact, and Verification.

### 3. Professional Navigation
- **Top Command Center**: A clean, centered search bar that acts as the global entry point.
- **Identification on Hover**: Quick-info tooltips that appear instantly on marker hover, showing the Company and ID.
- **Deep Linking**: Every license selection must update the URL/State so the "Experience" can be shared or bookmarked.

### 4. Fluid Physics
- **Weighted Motion**: Use `stiffness: 400, damping: 40` for panel entries. They should feel heavy and stable, not bouncy.
- **Spatial Focus**: When the Analysis Panel opens, the Map must subtly shift its center to keep the selected marker visible in the remaining viewport.

## 🛠️ Implementation Rules
- **No Traditional Sidebars**: Filters must live in a floating "Filter Hub" or a collapsible "Drawer."
- **Unified Selection State**: One `selectedItem` controls everything—the Map center, the Panel content, and the Highlight state.
- **Mapbox/Leaflet Optimization**: Ensure high-performance rendering even with 10,000+ markers using advanced clustering.
