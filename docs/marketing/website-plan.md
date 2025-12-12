# RawRequest Launch Site Plan

## Goals
- Position RawRequest as the opinionated, fast alternative to heavy REST clients.
- Drive visitors toward two CTAs: download the app and join the waitlist/newsletter.
- Showcase the new cancellation-aware workflow and IDE-like ergonomics.
- Highlight social proof (stats, testimonials) to build credibility ahead of launch.

## Target Personas
1. **Indie API builders** who need a lightweight request runner with scripting.
2. **Backend/product engineers** replacing GUI-heavy tools but wanting chaining + environment support.
3. **Developer advocates** who need a presentable tool for demos/livecoding.

## Single-Page Layout
1. **Hero**
   - Bold headline + subcopy.
   - Primary CTA (Download for macOS) and secondary CTA (Join Waitlist).
   - Background gradient with subtle animated grid, product screenshot mockup.
2. **Feature Highlights**
   - Cards for: Request Chaining, Environment-Aware Variables, Live Cancellation & Status, Scriptable Assertions, Load Testing.
   - Each card uses iconography + short supporting copy.
3. **Workflow Strip**
   - Horizontal timeline (Compose → Execute → Inspect → Automate) explaining how RawRequest fits into daily flow.
   - Include inline code snippet (HTTP request) and screenshot placeholder.
4. **Speed & Reliability Metrics**
   - Stats row (e.g., "47% faster iteration", "4,200+ saved requests", "8 ms average queue time").
5. **Testimonials / Logos**
   - Carousel or simple cards with headshots + quotes.
6. **Comparison Section**
   - Table comparing RawRequest vs Postman vs Bruno vs curl scripts.
7. **Call-to-Action Banner**
   - Reiterate download + waitlist with gradient background.
8. **Footer**
   - Links to docs, GitHub, Homebrew formula instructions, privacy.

## Visual Direction
- Dark hero with vibrant accent (#8b5cf6 / #22d3ee) plus frosted glass cards.
- Rounded corners (16px), soft drop shadows, generous white space.
- Use Inter for copy and JetBrains Mono for code snippets.

## Interactions
- Scroll-based fade-in for cards.
- Hover lift/shadow on feature boxes.
- Animated dots for "Sending request" callouts to echo in-app status banner.

## Technical Approach
- Static site (HTML/CSS/TS) under `website/` folder to keep distribution simple.
- No build step required; rely on modern CSS.
- Separate assets folder for screenshots and logos (placeholder images for now).

## Content Checklist
- Updated copy for new cancellation UI ("Cancel in-flight chains with one click").
- Short blurb on Homebrew distribution.
- Embedded GIF/video placeholder demonstrating queued requests.
- Newsletter form stub (non-functional yet, but ready for future hook).

## Next Steps
1. Scaffold `website/` with `index.html`, `styles.css`, `app.js`, and `assets/`.
2. Implement hero + feature + CTA sections using plan above.
3. Add TODO comments in HTML where real screenshots/testimonials will live.
4. Hook CTAs to `https://rawrequest.app/download` placeholder + `mailto` for waitlist.
