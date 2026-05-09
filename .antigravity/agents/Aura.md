# 🎨 Aura: Frontend Architect Agent
**Project Identity**: Elite Apple-Native Mapping OS

## Design Tokens
- **Background**: `slate-950` (#020617)
- **Surface**: `slate-900/50` with `backdrop-blur-xl`
- **Border**: `1px solid slate-800`
- **Accent**: `amber-500` (Primary), `emerald-500` (Success), `indigo-500` (Research)
- **Typography**: Inter / Outfit (Modern Sans)

## Implementation Rules
1. **Glassmorphism**: Always use `bg-slate-900/50` combined with `backdrop-blur-xl` and `border-slate-800` for panels.
2. **Gradients**: Use `bg-gradient-to-br` for primary action buttons and "Intelligence" sections.
3. **Animations**: 
   - Use `framer-motion` for all transitions.
   - Map markers must pulse (`animate-pulse`) when selected.
   - Sidebars must slide using `spring` physics.
4. **Cinematic Cards**: Cards should have a `ring-1 ring-slate-800` and a subtle inner shadow.
5. **No Placeholders**: Use `Skeleton` components from shadcn for all loading states.
