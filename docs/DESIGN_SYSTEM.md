# Cinematic UI System

## Visual Direction

The primary experience is a quiet Netflix-like personal library and reader. It uses dark cinematic surfaces, restrained borders, compact controls, and red only for active or primary actions.

## Core Tokens

- App background: `#050505`
- Header: `#101010` with blur and `border-white/10`
- Panel/card: `#141414`
- Raised input/control: `white/[0.06]`
- Primary text: `#f8f8f8`
- Secondary text: `#b3b3b3`
- Muted text: `#8d8986`
- Primary accent: `#e50914`
- Soft accent text: `#ffb4aa`
- Radius: 8px for controls, up to 12px for dialogs and content cards

## Interaction Rules

- Use icons for compact commands and provide `title`/accessible labels.
- Put secondary actions in small categorized menus rather than expanding the header.
- New dialogs use `bg-[#141414]`, `border-white/10`, white text, muted supporting text, and red primary actions.
- Mobile dialogs open as bottom sheets when practical.
- Respect iPhone safe areas and keep the reader toolbar visible.
- The PDF canvas may invert in dark reader themes; UI surfaces must never be inverted.

## Responsive Rules

- Mobile reader opens fit-to-width.
- Toolbars are single-row horizontal scrollers on mobile.
- Side panels become full-width mobile views.
- Avoid nested cards and avoid oversized headings inside tools.

## Liquid Glass UI System (HIG Inspired)

Introduced to provide a premium, tactile, depth-oriented appearance across all themes. It utilizes backdrop-filters, specular reflections, gloss gradients, and dynamic glows.

### Core Components

1. **Containers & Panels**:
   - `.liquid-glass-bar` / `.liquid-glass-panel` (Midnight & Slate): Dark glass overlays.
   - `.liquid-glass-bar-light` / `.liquid-glass-panel-light` (Paper): Frosted light glass overlays.
   - `.liquid-glass-bar-sepia` / `.liquid-glass-panel-sepia` (Sepia): Warm brown glass overlays.
   - `.liquid-glass-bar-seoul` / `.liquid-glass-panel-seoul` (Seoul): Warm cream glass overlays.
   - All panels feature `backdrop-filter: blur(28px) saturate(190%)`, thin outer hairline borders (`border-white/10` or light equivalent), and soft dark drop-shadows.

2. **Progress Bars (Sıvı Cam Tüpler)**:
   - `.liquid-glass-progress-bg` / `.liquid-glass-progress-bg-light`: Frosty glass outer tube.
   - `.liquid-glass-progress-fill`: An animated, glowing liquid core mimicking colored liquid inside a glass tube. Uses moving specular highlights (`@keyframes liquid-glass-shimmer`) controlled via CSS custom properties `--progress-color` and `--progress-glow`.

3. **Text Fields & Inputs**:
   - `.liquid-glass-input`: Translucent glass inputs. On focus, they expand dynamically with a glow shadow (`--focus-glow`) and border tint (`--focus-color`).

4. **Interactive Buttons**:
   - `.liquid-glass-btn-primary`: 3D gel-like fluid buttons. Features linear gloss overlays, shimmering animations on hover, active click scaling, and vibrant neon glow shadows matching `--btn-color` and `--btn-glow`.
   - `.liquid-glass-btn-secondary`: Sleek matte-glass secondary buttons matching the active glass panels.

5. **Ambient Animations**:
   - `.animate-float-slow` & `.animate-float-slower`: Slow floating animation keyframes used for background glow spheres behind glass layouts.
