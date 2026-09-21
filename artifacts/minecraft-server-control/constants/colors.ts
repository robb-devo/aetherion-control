/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#F5F7FA',
    tint: '#A970FF',

    // Core surfaces
    background: '#08070D',
    foreground: '#F5F7FA',

    // Cards / elevated surfaces
    card: '#14111D',
    cardForeground: '#F5F7FA',

    // Primary action color (buttons, links, active states)
    primary: '#A970FF',
    primaryForeground: '#100A17',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#211A2E',
    secondaryForeground: '#F5F7FA',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#1A1623',
    mutedForeground: '#958AA8',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#251739',
    accentForeground: '#D7B8FF',

    // Destructive actions (delete, error states)
    destructive: '#FF6B6B',
    destructiveForeground: '#0B0E12',

    // Borders and input outlines
    border: '#302740',
    input: '#211A2E',
    success: '#6EE7C1',
    warning: '#FFCC66',
    info: '#8EB8FF',
    overlay: 'rgba(8, 7, 13, 0.86)',
  },

  dark: {
    text: '#F5F7FA',
    tint: '#A970FF',
    background: '#08070D',
    foreground: '#F5F7FA',
    card: '#14111D',
    cardForeground: '#F5F7FA',
    primary: '#A970FF',
    primaryForeground: '#100A17',
    secondary: '#211A2E',
    secondaryForeground: '#F5F7FA',
    muted: '#1A1623',
    mutedForeground: '#958AA8',
    accent: '#251739',
    accentForeground: '#D7B8FF',
    destructive: '#FF6B6B',
    destructiveForeground: '#0B0E12',
    border: '#302740',
    input: '#211A2E',
    success: '#6EE7C1',
    warning: '#FFCC66',
    info: '#8EB8FF',
    overlay: 'rgba(8, 7, 13, 0.86)',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 8,
};

export default colors;
